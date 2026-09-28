// ============================================================
// SUPABASE API CORE
// Generic helpers + User auth + Inventory + Vendors + Requestors
// v3 — Fixed sbGetAll with inline fetch (no recursion)
// ============================================================

// ═══════════════════════════════════════════════════════════════
// GENERIC REST HELPERS
// ═══════════════════════════════════════════════════════════════

async function sbGet(table, query) {
  var url = sbUrl(table) + (query ? '?' + query : '');
  try {
    var res = await fetch(url, { headers: sbHeaders() });
    if (!res.ok) {
      var errText = await res.text();
      throw new Error('HTTP ' + res.status + ' — ' + errText);
    }
    return await res.json();
  } catch (e) {
    console.error('[sbGet]', table, e.message);
    throw e;
  }
}

async function sbPost(table, body) {
  try {
    var res = await fetch(sbUrl(table), {
      method: 'POST',
      headers: sbHeaders(),
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      var errText = await res.text();
      throw new Error('HTTP ' + res.status + ' — ' + errText);
    }
    return await res.json();
  } catch (e) {
    console.error('[sbPost]', table, e.message);
    throw e;
  }
}

async function sbPatch(table, query, body) {
  try {
    var res = await fetch(sbUrl(table) + '?' + query, {
      method: 'PATCH',
      headers: sbHeaders(),
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      var errText = await res.text();
      throw new Error('HTTP ' + res.status + ' — ' + errText);
    }
    var text = await res.text();
    return text ? JSON.parse(text) : [];
  } catch (e) {
    console.error('[sbPatch]', table, e.message);
    throw e;
  }
}

async function sbDelete(table, query) {
  try {
    var res = await fetch(sbUrl(table) + '?' + query, {
      method: 'DELETE',
      headers: sbHeaders()
    });
    if (!res.ok) {
      var errText = await res.text();
      throw new Error('HTTP ' + res.status + ' — ' + errText);
    }
    return true;
  } catch (e) {
    console.error('[sbDelete]', table, e.message);
    throw e;
  }
}

// ═══════════════════════════════════════════════════════════════
// PAGINATION HELPER — direct inline fetch, no recursion
// ═══════════════════════════════════════════════════════════════
async function sbGetAll(table, baseQuery) {
  var allRows = [];
  var offset = 0;
  var limit = 1000;
  var hasMore = true;

  // Strip any leading ? or & to avoid double separators
  var cleanQuery = String(baseQuery || '').replace(/^[?&]+/, '');

  while (hasMore) {
    // Build the query string cleanly: filters first, then limit, then offset
    var parts = [];
    if (cleanQuery) parts.push(cleanQuery);
    parts.push('limit=' + limit);
    parts.push('offset=' + offset);
    var q = parts.join('&');

    var url = sbUrl(table) + '?' + q;
    var res = await fetch(url, { headers: sbHeaders() });
    if (!res.ok) {
      var errText = await res.text();
      throw new Error('sbGetAll HTTP ' + res.status + ' — ' + errText);
    }
    var batch = await res.json();
    if (!batch || batch.length === 0) break;
    allRows = allRows.concat(batch);
    if (batch.length < limit) hasMore = false;
    else offset += limit;
  }
  return allRows;
}

// ═══════════════════════════════════════════════════════════════
// USER AUTHENTICATION
// ═══════════════════════════════════════════════════════════════

async function sbVerifyUser(username, password) {
  try {
    var rows = await sbGet('users',
      'username=eq.' + encodeURIComponent(username)
      + '&password=eq.' + encodeURIComponent(password)
      + '&select=username,fullname,roles,department'
      + '&limit=1'
    );
    if (!rows || rows.length === 0) {
      return { success: false, error: 'Invalid username or password' };
    }
    var u = rows[0];
    var roles = Array.isArray(u.roles) && u.roles.length > 0 ? u.roles : ['warehouse'];
    return {
      success: true,
      username: u.username,
      fullname: u.fullname,
      roles: roles,
      primaryRole: roles[0]
    };
  } catch (err) {
    console.error('[sbVerifyUser]', err);
    return { success: false, error: err.message };
  }
}

async function sbGetUsers() {
  try {
    var rows = await sbGetAll('users',
      'select=username,fullname,roles,department&order=username.asc'
    );
    return { success: true, users: rows || [] };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ═══════════════════════════════════════════════════════════════
// INVENTORY — with pagination for 3000+ items
// ═══════════════════════════════════════════════════════════════

async function sbGetInventoryItems() {
  try {
    var rows = await sbGetAll('inventory',
      'select=item_code,description,unit,item_class&order=item_code.asc'
    );
    var items = (rows || []).map(function(r) {
      return {
        inventoryId: r.item_code,
        code: r.item_code,
        description: r.description || '-',
        unit: r.unit || 'PIECE',
        itemClass: r.item_class || ''
      };
    });
    return { success: true, items: items, total: items.length };
  } catch (err) {
    console.error('[sbGetInventoryItems]', err);
    return { success: false, error: err.message, items: [] };
  }
}

async function sbGetInventoryList() {
  try {
    var rows = await sbGetAll('inventory',
      'select=item_code,description,unit,item_class&order=item_code.asc'
    );
    var items = (rows || []).map(function(r) {
      return {
        code: r.item_code,
        inventoryId: r.item_code,
        description: r.description || '',
        unit: r.unit || 'PIECE',
        itemClass: r.item_class || ''
      };
    });
    return { success: true, inventory: items };
  } catch (err) {
    console.error('[sbGetInventoryList]', err);
    return { success: false, error: err.message, inventory: [] };
  }
}

// ═══════════════════════════════════════════════════════════════
// REQUESTORS
// ═══════════════════════════════════════════════════════════════

async function sbGetRequestorList() {
  try {
    var rows = await sbGetAll('requestors',
      'select=name,department&order=name.asc'
    );
    return { success: true, requestors: rows || [] };
  } catch (err) {
    console.error('[sbGetRequestorList]', err);
    return { success: false, error: err.message, requestors: [] };
  }
}

// ═══════════════════════════════════════════════════════════════
// VENDORS
// ═══════════════════════════════════════════════════════════════

async function sbGetVendorList() {
  try {
    var rows = await sbGetAll('vendors',
      'select=name&order=name.asc'
    );
    var vendors = (rows || []).map(function(r) { return r.name; });
    return { success: true, vendors: vendors };
  } catch (err) {
    console.error('[sbGetVendorList]', err);
    return { success: false, error: err.message, vendors: [] };
  }
}

// ═══════════════════════════════════════════════════════════════
// IVM TEAM
// ═══════════════════════════════════════════════════════════════

async function sbGetIvmTeamList() {
  try {
    var rows = await sbGetAll('ivm_team',
      'select=name&order=name.asc'
    );
    var members = (rows || []).map(function(r) { return r.name; });
    return { success: true, members: members };
  } catch (err) {
    console.error('[sbGetIvmTeamList]', err);
    return { success: false, error: err.message, members: [] };
  }
}

// ═══════════════════════════════════════════════════════════════
// PREP STATUS
// ═══════════════════════════════════════════════════════════════

async function sbGetAllPrepStatuses() {
  try {
    var rows = await sbGetAll('prep_status',
      'select=doc_no,prep_status,updated_by,updated_at'
    );
    var statuses = {};
    (rows || []).forEach(function(r) {
      statuses[r.doc_no] = {
        prepStatus: String(r.prep_status || 'NEW').toUpperCase(),
        updatedBy: r.updated_by || '',
        updatedAt: r.updated_at ? new Date(r.updated_at).getTime() : 0
      };
    });
    return { success: true, statuses: statuses };
  } catch (err) {
    console.error('[sbGetAllPrepStatuses]', err);
    return { success: false, error: err.message, statuses: {} };
  }
}

async function sbSetPrepStatus(docNo, prepStatus, updatedBy) {
  if (!docNo) return { success: false, error: 'docNo required' };
  try {
    var normalized = String(prepStatus || 'NEW').toUpperCase();
    if (normalized !== 'PREPARED' && normalized !== 'PICKED_UP') normalized = 'NEW';

    var existing = await sbGet('prep_status',
      'doc_no=eq.' + encodeURIComponent(docNo) + '&select=id&limit=1'
    );

    if (existing && existing.length > 0) {
      await sbPatch('prep_status',
        'doc_no=eq.' + encodeURIComponent(docNo),
        {
          prep_status: normalized,
          updated_by: String(updatedBy || '').trim(),
          updated_at: new Date().toISOString()
        }
      );
    } else {
      await sbPost('prep_status', {
        doc_no: docNo,
        prep_status: normalized,
        updated_by: String(updatedBy || '').trim(),
        updated_at: new Date().toISOString()
      });
    }

    return { success: true, docNo: docNo, prepStatus: normalized };
  } catch (err) {
    console.error('[sbSetPrepStatus]', err);
    return { success: false, error: err.message };
  }
}

// ═══════════════════════════════════════════════════════════════
// IDEMPOTENCY
// ═══════════════════════════════════════════════════════════════

async function sbCheckIdempotency(key) {
  if (!key) return null;
  try {
    var rows = await sbGet('idempotency_keys',
      'key=eq.' + encodeURIComponent(key) + '&select=response&limit=1'
    );
    if (rows && rows.length > 0) {
      var r = rows[0].response;
      if (r && typeof r === 'object') r._replayed = true;
      return r;
    }
    return null;
  } catch (e) {
    return null;
  }
}

async function sbSaveIdempotency(key, response) {
  if (!key) return;
  try {
    await sbPost('idempotency_keys', {
      key: key,
      response: response
    });
  } catch (e) {
    if (String(e.message).indexOf('409') === -1 && String(e.message).indexOf('duplicate') === -1) {
      console.warn('[sbSaveIdempotency]', e.message);
    }
  }
}

async function sbProcessWithIdempotency(key, fn) {
  if (!key) return fn();
  var cached = await sbCheckIdempotency(key);
  if (cached) return cached;
  var result = await fn();
  await sbSaveIdempotency(key, result);
  return result;
}

console.log('✅ supabase-api-core.js loaded (v3)');
