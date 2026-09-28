// ============================================================
// SUPABASE API CORE
// Generic helpers + User auth + Inventory + Vendors + Requestors
// ============================================================

// ═══════════════════════════════════════════════════════════════
// GENERIC REST HELPERS
// These wrap Supabase's PostgREST API — same feel as GAS but faster.
// ═══════════════════════════════════════════════════════════════

// ─── Generic GET with query string ───
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

// ─── Generic POST (insert) ───
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

// ─── Generic PATCH (update) ───
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

// ─── Generic DELETE ───
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
// USER AUTHENTICATION
// Same output shape as GAS verifyUser so the rest of the app
// doesn't need changes.
// ═══════════════════════════════════════════════════════════════

async function sbVerifyUser(username, password) {
  try {
    var rows = await sbGet('users',
      'username=eq.' + encodeURIComponent(username) +
      '&password=eq.' + encodeURIComponent(password) +
      '&select=username,fullname,roles,department' +
      '&limit=1'
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
    var rows = await sbGet('users',
      'select=username,fullname,roles,department&order=username.asc'
    );
    return { success: true, users: rows || [] };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ═══════════════════════════════════════════════════════════════
// INVENTORY
// ═══════════════════════════════════════════════════════════════

// Same shape as GAS getInventoryItems (returns items array)
async function sbGetInventoryItems() {
  try {
    var rows = await sbGet('inventory',
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
    return { success: false, error: err.message };
  }
}

// Same shape as GAS getInventoryList (returns inventory array)
async function sbGetInventoryList() {
  try {
    var rows = await sbGet('inventory',
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
    return { success: false, error: err.message };
  }
}

// ═══════════════════════════════════════════════════════════════
// REQUESTORS — for production request wizard
// ═══════════════════════════════════════════════════════════════

async function sbGetRequestorList() {
  try {
    var rows = await sbGet('requestors',
      'select=name,department&order=name.asc'
    );
    return { success: true, requestors: rows || [] };
  } catch (err) {
    console.error('[sbGetRequestorList]', err);
    return { success: false, error: err.message };
  }
}

// ═══════════════════════════════════════════════════════════════
// VENDORS — for manual MRR form
// ═══════════════════════════════════════════════════════════════

async function sbGetVendorList() {
  try {
    var rows = await sbGet('vendors',
      'select=name&order=name.asc'
    );
    var vendors = (rows || []).map(function(r) { return r.name; });
    return { success: true, vendors: vendors };
  } catch (err) {
    console.error('[sbGetVendorList]', err);
    return { success: false, error: err.message };
  }
}

// ═══════════════════════════════════════════════════════════════
// IVM TEAM — for "Prepared By" datalist
// ═══════════════════════════════════════════════════════════════

async function sbGetIvmTeamList() {
  try {
    var rows = await sbGet('ivm_team',
      'select=name&order=name.asc'
    );
    var members = (rows || []).map(function(r) { return r.name; });
    return { success: true, members: members };
  } catch (err) {
    console.error('[sbGetIvmTeamList]', err);
    return { success: false, error: err.message };
  }
}

// ═══════════════════════════════════════════════════════════════
// PREP STATUS (Red/Green/Yellow color coding)
// ═══════════════════════════════════════════════════════════════

async function sbGetAllPrepStatuses() {
  try {
    var rows = await sbGet('prep_status',
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

    // Check if exists
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
// IDEMPOTENCY (prevent duplicate submissions)
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
    // Ignore duplicate errors
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

console.log('✅ supabase-api-core.js loaded');
