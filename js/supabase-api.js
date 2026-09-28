// ============================================================
// SUPABASE API LAYER
// v1 — Core helpers only (Part 1)
// ============================================================

// ─── Generic GET ───
async function sbGet(table, query) {
  var url = sbUrl(table) + (query ? '?' + query : '');
  var res = await fetch(url, { headers: sbHeaders() });
  if (!res.ok) {
    var err = await res.text();
    throw new Error('Supabase GET ' + table + ' failed: ' + err);
  }
  return await res.json();
}

// ─── Generic POST (insert) ───
async function sbPost(table, body) {
  var res = await fetch(sbUrl(table), {
    method: 'POST',
    headers: sbHeaders(),
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    var err = await res.text();
    throw new Error('Supabase POST ' + table + ' failed: ' + err);
  }
  return await res.json();
}

// ─── Generic PATCH (update) ───
async function sbPatch(table, query, body) {
  var res = await fetch(sbUrl(table) + '?' + query, {
    method: 'PATCH',
    headers: sbHeaders(),
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    var err = await res.text();
    throw new Error('Supabase PATCH ' + table + ' failed: ' + err);
  }
  return await res.json();
}

// ─── Generic DELETE ───
async function sbDelete(table, query) {
  var res = await fetch(sbUrl(table) + '?' + query, {
    method: 'DELETE',
    headers: sbHeaders()
  });
  if (!res.ok) {
    var err = await res.text();
    throw new Error('Supabase DELETE ' + table + ' failed: ' + err);
  }
  return true;
}

// ═══════════════════════════════════════════════════════════════
// USER AUTHENTICATION
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
    var roles = Array.isArray(u.roles) ? u.roles : ['warehouse'];
    return {
      success: true,
      username: u.username,
      fullname: u.fullname,
      roles: roles,
      primaryRole: roles[0]
    };
  } catch(err) {
    return { success: false, error: err.message };
  }
}

async function sbGetUsers() {
  try {
    var rows = await sbGet('users', 'select=username,fullname,roles,department&order=username.asc');
    return { success: true, users: rows || [] };
  } catch(err) {
    return { success: false, error: err.message };
  }
}

// ═══════════════════════════════════════════════════════════════
// INVENTORY
// ═══════════════════════════════════════════════════════════════

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
  } catch(err) {
    return { success: false, error: err.message };
  }
}

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
  } catch(err) {
    return { success: false, error: err.message };
  }
}

// ═══════════════════════════════════════════════════════════════
// REQUESTORS
// ═══════════════════════════════════════════════════════════════

async function sbGetRequestorList() {
  try {
    var rows = await sbGet('requestors', 'select=name,department&order=name.asc');
    return { success: true, requestors: rows || [] };
  } catch(err) {
    return { success: false, error: err.message };
  }
}

// ═══════════════════════════════════════════════════════════════
// VENDORS
// ═══════════════════════════════════════════════════════════════

async function sbGetVendorList() {
  try {
    var rows = await sbGet('vendors', 'select=name&order=name.asc');
    var vendors = (rows || []).map(function(r) { return r.name; });
    return { success: true, vendors: vendors };
  } catch(err) {
    return { success: false, error: err.message };
  }
}

async function sbGetIvmTeamList() {
  try {
    var rows = await sbGet('ivm_team', 'select=name&order=name.asc');
    var members = (rows || []).map(function(r) { return r.name; });
    return { success: true, members: members };
  } catch(err) {
    return { success: false, error: err.message };
  }
}
