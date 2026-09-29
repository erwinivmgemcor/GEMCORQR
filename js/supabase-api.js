// ============================================================
// SUPABASE API LAYER
// Fast reads (0.1s) — falls back to GAS for writes
// ============================================================

async function _sbGet(table, query) {
  var url = sbUrl(table) + (query ? '?' + query : '');
  var res = await fetch(url, {
    method: 'GET',
    headers: sbHeaders(),
    cache: 'no-store'
  });
  if (!res.ok) {
    var err = await res.text();
    throw new Error('Supabase GET ' + table + ' failed: ' + res.status + ' ' + err);
  }
  return await res.json();
}

// ═══════════════════════════════════════════════════════════════
// INVENTORY — 3,164 items
// ═══════════════════════════════════════════════════════════════
async function sbGetInventoryList() {
  try {
    var rows = await _sbGet('inventory',
      'select=item_code,description,unit,item_class&order=item_code.asc'
    );
    var items = (rows || []).map(function(r) {
      return {
        code: r.item_code,
        inventoryId: r.item_code,
        description: r.description || '',
        unit: r.unit || 'PCS',
        itemClass: r.item_class || ''
      };
    });
    return { success: true, inventory: items, total: items.length };
  } catch(err) {
    console.warn('[Supabase] getInventoryList failed:', err.message);
    return { success: false, error: err.message };
  }
}

async function sbGetInventoryItems() {
  try {
    var rows = await _sbGet('inventory',
      'select=item_code,description,unit,item_class&order=item_code.asc'
    );
    var items = (rows || []).map(function(r) {
      return {
        inventoryId: r.item_code,
        code: r.item_code,
        description: r.description || '-',
        unit: r.unit || 'PCS',
        itemClass: r.item_class || ''
      };
    });
    return { success: true, items: items, total: items.length };
  } catch(err) {
    console.warn('[Supabase] getInventoryItems failed:', err.message);
    return { success: false, error: err.message };
  }
}

// ═══════════════════════════════════════════════════════════════
// DOCUMENTS — 164 rows from DOCLINKS
// ═══════════════════════════════════════════════════════════════
async function sbGetAllPendingDocs(includeCompleted) {
  try {
    var query = 'select=*&order=created_at.desc';
    if (!includeCompleted) {
      query += '&status=in.(PENDING,PARTIAL)';
    }
    var rows = await _sbGet('documents', query);
    var docs = (rows || []).map(function(r) {
      var upperDoc = String(r.doc_no || '').toUpperCase();
      return {
        docNo: r.doc_no,
        sheetName: r.doc_no,
        docType: String(r.doc_type || '').toUpperCase(),
        isBal: !!r.is_bal || upperDoc.indexOf('BAL.') === 0,
        status: String(r.status || 'PENDING').toUpperCase(),
        requestor: r.requestor || '',
        department: r.department || '',
        itemSummary: r.item_summary || '',
        timestamp: r.created_at || null,
        processedBy: r.processed_by || '',
        processedAt: r.processed_at || null,
        joNo: r.jo_no || '',
        gemSoNo: r.gem_so_no || '',
        clientName: r.client_name || '',
        project: r.project || '',
        poNo: r.po_no || '',
        vendor: r.vendor || '',
        drNo: r.dr_no || '',
        receivingSite: r.receiving_site || '',
        preparedBy: r.prepared_by || '',
        datePrepared: r.date_prepared || '',
        receivingDate: r.receiving_date || ''
      };
    });
    return { success: true, documents: docs, total: docs.length };
  } catch(err) {
    console.warn('[Supabase] getAllPendingDocs failed:', err.message);
    return { success: false, error: err.message, documents: [] };
  }
}

async function sbGetPendingDocCount(docType) {
  try {
    docType = String(docType || 'MRIF').toUpperCase();
    var rows = await _sbGet('documents',
      'select=status,doc_type,doc_no&doc_type=eq.' + docType
    );
    var pending = 0, completed = 0, partial = 0, total = 0;
    var pendingDocs = [];
    (rows || []).forEach(function(r) {
      total++;
      var s = String(r.status || '').toUpperCase();
      if (s === 'PENDING') { pending++; pendingDocs.push({ docNo: r.doc_no, sheetName: r.doc_no }); }
      else if (s === 'COMPLETED') completed++;
      else if (s === 'PARTIAL') partial++;
    });
    return {
      success: true,
      pendingCount: pending,
      partialCount: partial,
      completedCount: completed,
      totalCount: total,
      documents: pendingDocs
    };
  } catch(err) {
    console.warn('[Supabase] getPendingDocCount failed:', err.message);
    return { success: false, error: err.message };
  }
}

// ═══════════════════════════════════════════════════════════════
// PARTIAL DOCS — reads from documents table
// Filters: status=PARTIAL AND doc_type=X
// ═══════════════════════════════════════════════════════════════
async function sbGetPartialDocsByType(docType) {
  try {
    docType = String(docType || 'MRIF').toUpperCase();
    var rows = await _sbGet('documents',
      'select=*&status=eq.PARTIAL&doc_type=eq.' + docType + '&order=created_at.desc'
    );

    var docs = (rows || []).map(function(r) {
      var upperDoc = String(r.doc_no || '').toUpperCase();
      return {
        docNo: r.doc_no,
        docType: docType,
        isBal: !!r.is_bal || upperDoc.indexOf('BAL.') === 0,
        totalItems: 0,
        servedItems: 0,
        partialItems: 0,
        zeroItems: 0,
        remainingQty: 0,
        firstItemCode: '',
        firstItemDesc: '',
        requestor: r.requestor || '',
        department: r.department || '',
        joNo: r.jo_no || '',
        gemSoNo: r.gem_so_no || '',
        clientName: r.client_name || '',
        project: r.project || '',
        vendor: r.vendor || '',
        poNo: r.po_no || '',
        drNo: r.dr_no || '',
        receivingSite: r.receiving_site || '',
        datePrepared: r.date_prepared || '',
        receivingDate: r.receiving_date || '',
        preparedBy: r.prepared_by || ''
      };
    });

    return { success: true, documents: docs, total: docs.length };
  } catch(err) {
    console.warn('[Supabase] getPartialDocsByType failed:', err.message);
    return { success: false, error: err.message, documents: [] };
  }
}

// ═══════════════════════════════════════════════════════════════
// PENDING REQUESTS — from documents table
// ═══════════════════════════════════════════════════════════════
async function sbGetPendingRequests() {
  try {
    var rows = await _sbGet('documents',
      'select=*&status=eq.PENDING&order=created_at.desc'
    );
    var requests = (rows || []).map(function(r) {
      var summary = String(r.item_summary || '');
      var parts = summary.split(' x');
      var itemCode = parts[0] || '';
      var qty = parts.length > 1 ? parseInt(parts[1].split(',')[0].trim()) || 0 : 0;
      return {
        docNo: r.doc_no,
        type: String(r.doc_type || '').toUpperCase(),
        requestor: r.requestor || '',
        status: 'PENDING',
        timestamp: r.created_at || new Date().toISOString(),
        itemCode: itemCode,
        qty: qty,
        url: ''
      };
    });
    return { success: true, requests: requests };
  } catch(err) {
    console.warn('[Supabase] getPendingRequests failed:', err.message);
    return { success: false, error: err.message, requests: [] };
  }
}

async function sbGetMyRequests(requestor) {
  try {
    if (!requestor) return { success: false, error: 'requestor required', requests: [] };
    var rows = await _sbGet('documents',
      'select=*&requestor=eq.' + encodeURIComponent(requestor) + '&order=created_at.desc'
    );
    var requests = (rows || []).map(function(r) {
      var summary = String(r.item_summary || '');
      var parts = summary.split(' x');
      var itemCode = parts[0] || '';
      var qty = parts.length > 1 ? parseInt(parts[1].split(',')[0].trim()) || 0 : 0;
      return {
        docNo: r.doc_no,
        type: String(r.doc_type || '').toUpperCase(),
        requestor: r.requestor || '',
        status: String(r.status || 'PENDING').toUpperCase(),
        timestamp: r.created_at || null,
        itemCode: itemCode,
        qty: qty,
        department: r.department || ''
      };
    });
    return { success: true, requests: requests };
  } catch(err) {
    console.warn('[Supabase] getMyRequests failed:', err.message);
    return { success: false, error: err.message, requests: [] };
  }
}

// ═══════════════════════════════════════════════════════════════
// ANALYTICS — from documents table
// ═══════════════════════════════════════════════════════════════
async function sbGetDashboardAnalytics() {
  try {
    var rows = await _sbGet('documents', 'select=*&order=created_at.desc');
    var data = rows || [];

    var now = new Date();
    var thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    var itemCounts = {}, staffCounts = {}, requestorCounts = {};
    var processingTimesHours = [];
    var total = 0, pending = 0, completed = 0, partial = 0;
    var mrifCount = 0, mrrCount = 0, mrsCount = 0;
    var dailyMrif = {}, dailyMrr = {}, dailyMrs = {};

    for (var d = 0; d < 30; d++) {
      var ds = new Date(now.getTime() - d * 86400000).toISOString().slice(0, 10);
      dailyMrif[ds] = 0; dailyMrr[ds] = 0; dailyMrs[ds] = 0;
    }

    data.forEach(function(r) {
      total++;
      var type = String(r.doc_type || '').toUpperCase();
      if (type === 'MRIF') mrifCount++;
      else if (type === 'MRR') mrrCount++;
      else if (type === 'MRS') mrsCount++;

      var status = String(r.status || 'PENDING').toUpperCase();
      if (status === 'PENDING') pending++;
      else if (status === 'COMPLETED') completed++;
      else if (status === 'PARTIAL') partial++;

      if (r.created_at) {
        var dt = new Date(r.created_at);
        if (!isNaN(dt.getTime()) && dt >= thirtyDaysAgo) {
          var ds2 = dt.toISOString().slice(0, 10);
          if (type === 'MRIF' && dailyMrif[ds2] !== undefined) dailyMrif[ds2]++;
          else if (type === 'MRR' && dailyMrr[ds2] !== undefined) dailyMrr[ds2]++;
          else if (type === 'MRS' && dailyMrs[ds2] !== undefined) dailyMrs[ds2]++;
        }
      }

      if (type === 'MRIF' && r.item_summary) {
        String(r.item_summary).split(',').forEach(function(chunk) {
          var m = chunk.trim().match(/^(.+?)\s+x\s*(\d+)/i);
          if (m) {
            var code = m[1].trim();
            var qty = parseInt(m[2], 10) || 0;
            if (!itemCounts[code]) itemCounts[code] = { count: 0, totalQty: 0 };
            itemCounts[code].count++;
            itemCounts[code].totalQty += qty;
          }
        });
      }

      if (r.processed_by) {
        var staff = String(r.processed_by).trim();
        if (staff) staffCounts[staff] = (staffCounts[staff] || 0) + 1;
      }

      if (type === 'MRIF' && r.requestor) {
        var req = String(r.requestor).trim();
        if (req && req.toUpperCase() !== 'WAREHOUSE') {
          requestorCounts[req] = (requestorCounts[req] || 0) + 1;
        }
      }

      if (status === 'COMPLETED' && r.created_at && r.processed_at) {
        var created = new Date(r.created_at);
        var processed = new Date(r.processed_at);
        if (!isNaN(created.getTime()) && !isNaN(processed.getTime()) && processed >= created) {
          var diffHours = (processed - created) / 3600000;
          if (diffHours >= 0) processingTimesHours.push(diffHours);
        }
      }
    });

    var sortedDates = Object.keys(dailyMrif).sort();
    var dailyRequests = sortedDates.map(function(date) {
      return {
        date: date,
        mrif: dailyMrif[date] || 0,
        mrr: dailyMrr[date] || 0,
        mrs: dailyMrs[date] || 0,
        count: (dailyMrif[date] || 0) + (dailyMrr[date] || 0) + (dailyMrs[date] || 0)
      };
    });

    var sortedItems = Object.keys(itemCounts).sort(function(a, b) {
      return itemCounts[b].count - itemCounts[a].count;
    });
    var topItems = sortedItems.map(function(code) {
      return { itemCode: code, count: itemCounts[code].count, totalQty: itemCounts[code].totalQty };
    });

    var sortedStaff = Object.keys(staffCounts).sort(function(a, b) {
      return staffCounts[b] - staffCounts[a];
    });
    var staffPerformance = sortedStaff.map(function(name) {
      return { name: name, count: staffCounts[name] };
    });

    var sortedRequestors = Object.keys(requestorCounts).sort(function(a, b) {
      return requestorCounts[b] - requestorCounts[a];
    });
    var requestorPerformance = sortedRequestors.map(function(name) {
      return { name: name, count: requestorCounts[name] };
    });

    var avgHours = 0;
    if (processingTimesHours.length > 0) {
      avgHours = processingTimesHours.reduce(function(a, b) { return a + b; }, 0) / processingTimesHours.length;
    }

    return {
      success: true,
      dailyRequests: dailyRequests,
      topItems: topItems,
      staffPerformance: staffPerformance,
      requestorPerformance: requestorPerformance,
      avgProcessingTime: avgHours / 24,
      avgProcessingTimeHours: avgHours,
      totals: {
        total: total, pending: pending, completed: completed, partial: partial,
        mrif: mrifCount, mrr: mrrCount, mrs: mrsCount
      }
    };
  } catch(err) {
    console.warn('[Supabase] getDashboardAnalytics failed:', err.message);
    return { success: false, error: err.message };
  }
}

// ═══════════════════════════════════════════════════════════════
// USERS, REQUESTORS, VENDORS, IVM TEAM
// ═══════════════════════════════════════════════════════════════
async function sbVerifyUser(username, password) {
  try {
    var rows = await _sbGet('users',
      'username=eq.' + encodeURIComponent(username) +
      '&password=eq.' + encodeURIComponent(password) +
      '&select=username,fullname,roles,department&limit=1'
    );
    if (!rows || rows.length === 0) {
      return { success: false, error: 'Invalid username or password' };
    }
    var u = rows[0];
    var roles = Array.isArray(u.roles) ? u.roles : ['warehouse'];
    return {
      success: true,
      username: u.username,
      fullname: u.fullname,
      roles: roles,
      primaryRole: roles[0]
    };
  } catch(err) {
    console.warn('[Supabase] verifyUser failed:', err.message);
    return { success: false, error: err.message };
  }
}

async function sbGetRequestorList() {
  try {
    var rows = await _sbGet('requestors', 'select=name,department&order=name.asc');
    return { success: true, requestors: rows || [] };
  } catch(err) {
    console.warn('[Supabase] getRequestorList failed:', err.message);
    return { success: false, error: err.message };
  }
}

async function sbGetVendorList() {
  try {
    var rows = await _sbGet('vendors', 'select=name&order=name.asc');
    var vendors = (rows || []).map(function(r) { return r.name; });
    return { success: true, vendors: vendors };
  } catch(err) {
    console.warn('[Supabase] getVendorList failed:', err.message);
    return { success: false, error: err.message };
  }
}

async function sbGetIvmTeamList() {
  try {
    var rows = await _sbGet('ivm_team', 'select=name&order=name.asc');
    var members = (rows || []).map(function(r) { return r.name; });
    return { success: true, members: members };
  } catch(err) {
    console.warn('[Supabase] getIvmTeamList failed:', err.message);
    return { success: false, error: err.message };
  }
}

async function sbGetUsers() {
  try {
    var rows = await _sbGet('users', 'select=username,fullname,roles,department&order=username.asc');
    return { success: true, users: rows || [] };
  } catch(err) {
    console.warn('[Supabase] getUsers failed:', err.message);
    return { success: false, error: err.message };
  }
}

// ═══════════════════════════════════════════════════════════════
// HEALTH CHECK
// ═══════════════════════════════════════════════════════════════
async function sbHealthCheck() {
  try {
    var t0 = Date.now();
    var res = await fetch(sbUrl('inventory') + '?select=id&limit=1', {
      headers: sbHeaders()
    });
    var ok = res.ok;
    var elapsed = Date.now() - t0;
    return { success: ok, latency: elapsed };
  } catch(err) {
    return { success: false, error: err.message };
  }
}

console.log('✅ supabase-api.js loaded');
