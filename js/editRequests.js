// ============================================================
// EDIT REQUESTS — production requests permission, warehouse approves
// ============================================================

var _editReqState = {
  currentUser: null,
  currentFullname: '',
  pollTimer: null,
  badgeTimer: null,
  items: []
};

function _editReqIsMobile() {
  return window.matchMedia('(max-width: 767.98px)').matches;
}

window.initEditRequests = function() {
  _editReqState.currentUser = localStorage.getItem('ivm_username') || '';
  _editReqState.currentFullname = localStorage.getItem('ivm_userFullname') || _editReqState.currentUser;
  if (!_editReqState.currentUser) return;

  if (localStorage.getItem('ivm_userRole') === 'warehouse') {
    refreshEditReqBadge();
    if (_editReqState.badgeTimer) clearInterval(_editReqState.badgeTimer);
    _editReqState.badgeTimer = setInterval(refreshEditReqBadge, 30000);
  }
};

document.addEventListener('visibilitychange', function() {
  if (document.hidden) {
    if (_editReqState.badgeTimer) { clearInterval(_editReqState.badgeTimer); _editReqState.badgeTimer = null; }
    if (_editReqState.pollTimer) { clearInterval(_editReqState.pollTimer); _editReqState.pollTimer = null; }
  } else {
    if (_editReqState.currentUser && localStorage.getItem('ivm_userRole') === 'warehouse') initEditRequests();
  }
});

window.refreshEditReqBadge = async function() {
  if (localStorage.getItem('ivm_userRole') !== 'warehouse') return;
  try {
    var url = API_URL + '?action=getEditRequests&status=PENDING&_t=' + Date.now();
    var fetchFn = (typeof safeFetch === 'function') ? safeFetch : fetch;
    var res = await fetchFn(url, { redirect: 'follow' }, { timeout: 12000, retries: 0 });
    var text = await res.text();
    var data;
    try { data = JSON.parse(text); } catch(e) { return; }
    if (!data || !data.success) return;

    var badge = document.getElementById('editReqBadgeSidebar');
    if (badge) {
      badge.textContent = data.pendingCount || 0;
      badge.classList.toggle('d-none', (data.pendingCount || 0) === 0);
    }
    var prev = parseInt(localStorage.getItem('ivm_editReqCount') || '0');
    if ((data.pendingCount || 0) > prev && typeof playSuccessBeep === 'function') playSuccessBeep();
    localStorage.setItem('ivm_editReqCount', String(data.pendingCount || 0));
  } catch(e) {}
};

window.openEditRequestsModal = async function() {
  var modalEl = document.getElementById('editRequestsModal');
  if (!modalEl) { showToast('Edit Requests modal not found', 'danger'); return; }
  var modal = bootstrap.Modal.getOrCreateInstance(modalEl);
  var container = document.getElementById('editReqListContainer');
  if (container) container.innerHTML = '<div class="text-center py-4"><div class="spinner-border text-primary"></div></div>';
  var filterEl = document.getElementById('editReqFilter');
  if (filterEl) filterEl.value = 'PENDING';
  modal.show();
  await loadEditRequestsList();
};

window.loadEditRequestsList = async function() {
  var container = document.getElementById('editReqListContainer');
  var countEl = document.getElementById('editReqCount');
  if (!container) return;

  var filter = document.getElementById('editReqFilter') ? document.getElementById('editReqFilter').value : '';
  container.innerHTML = '<div class="text-center py-4"><div class="spinner-border text-primary"></div></div>';
  if (countEl) countEl.textContent = 'Loading...';

  try {
    var url = API_URL + '?action=getEditRequests&status=' + encodeURIComponent(filter) + '&_t=' + Date.now();
    var fetchFn = (typeof safeFetch === 'function') ? safeFetch : fetch;
    var res = await fetchFn(url, { redirect: 'follow' }, { timeout: 20000, retries: 1 });
    var text = await res.text();
    var data = JSON.parse(text);
    if (!data.success) throw new Error(data.error || 'Failed');

    var list = data.requests || [];
    if (countEl) countEl.textContent = list.length + ' request(s)';

    if (list.length === 0) {
      container.innerHTML = '<div class="list-group-item text-muted text-center py-4">' +
        '<i class="bi bi-inbox fs-3 d-block mb-2"></i>No edit requests found</div>';
      return;
    }

    var html = '<div class="list-group list-group-flush">';
    list.forEach(function(r) {
      var dateStr = r.requestedAt ? new Date(r.requestedAt).toLocaleString() : '';
      var statusColor = r.status === 'PENDING' ? 'warning text-dark'
                      : r.status === 'APPROVED' ? 'info text-dark'
                      : r.status === 'REJECTED' ? 'danger'
                      : 'success';
      var typeBadgeClass = r.docType === 'MRIF' ? 'bg-warning text-dark'
                          : r.docType === 'MRR' ? 'bg-success'
                          : r.docType === 'MRS' ? 'bg-danger'
                          : 'bg-secondary';

      var actionsHtml = '';
      if (r.status === 'PENDING') {
        actionsHtml =
          '<button class="btn btn-sm btn-success me-1 edit-req-approve" data-id="' + _editReqEsc(r.editReqId) + '">' +
            '<i class="bi bi-check-circle me-1"></i>Approve' +
          '</button>' +
          '<button class="btn btn-sm btn-outline-danger edit-req-reject" data-id="' + _editReqEsc(r.editReqId) + '">' +
            '<i class="bi bi-x-circle me-1"></i>Reject' +
          '</button>';
      } else if (r.status === 'APPROVED') {
        actionsHtml = '<small class="text-muted">Awaiting production edit</small>';
      } else if (r.status === 'REJECTED') {
        actionsHtml = '<small class="text-muted">Rejected</small>';
      } else {
        actionsHtml = '<small class="text-muted">Completed</small>';
      }

      html += '<div class="list-group-item">' +
        '<div class="d-flex justify-content-between align-items-start flex-wrap gap-2">' +
          '<div class="flex-grow-1" style="min-width:0;">' +
            '<div class="d-flex align-items-center gap-2 flex-wrap">' +
              '<span class="fw-bold">' + _editReqEsc(r.docNo) + '</span>' +
              '<span class="badge ' + typeBadgeClass + '">' + _editReqEsc(r.docType) + '</span>' +
              '<span class="badge bg-' + statusColor + '">' + _editReqEsc(r.status) + '</span>' +
            '</div>' +
            '<div class="small text-muted mt-1">' +
              '<i class="bi bi-person me-1"></i>' + _editReqEsc(r.requestedByFullname) +
              ' · <i class="bi bi-clock me-1"></i>' + dateStr +
            '</div>' +
            '<div class="small mt-2" style="background:#f8fafc;padding:8px 10px;border-radius:6px;">' +
              '<strong>Reason:</strong> ' + _editReqEsc(r.reason) +
            '</div>' +
            (r.status === 'REJECTED' && r.rejectReason
              ? '<div class="small mt-1 text-danger"><strong>Rejection:</strong> ' + _editReqEsc(r.rejectReason) + '</div>'
              : '') +
            (r.approvedBy
              ? '<div class="small text-muted mt-1">Handled by: ' + _editReqEsc(r.approvedBy) + '</div>'
              : '') +
          '</div>' +
          '<div class="d-flex gap-1 align-items-start">' + actionsHtml + '</div>' +
        '</div>' +
      '</div>';
    });
    html += '</div>';
    container.innerHTML = html;

    container.querySelectorAll('.edit-req-approve').forEach(function(btn) {
      btn.addEventListener('click', function() { approveEditReqAction(this.getAttribute('data-id')); });
    });
    container.querySelectorAll('.edit-req-reject').forEach(function(btn) {
      btn.addEventListener('click', function() { rejectEditReqAction(this.getAttribute('data-id')); });
    });

  } catch (err) {
    container.innerHTML = '<div class="list-group-item text-danger text-center py-4">' +
      '<i class="bi bi-exclamation-triangle-fill me-2"></i>Failed: ' + _editReqEsc(err.message) + '</div>';
    if (countEl) countEl.textContent = 'Error';
  }
};

async function approveEditReqAction(editReqId) {
  if (!editReqId) return;
  if (!confirm('Approve this edit request? The production user will be able to edit their request.')) return;
  try {
    var payload = { action: 'approveEditRequest', editReqId: editReqId, approver: _editReqState.currentUser };
    var fetchFn = (typeof safeFetch === 'function') ? safeFetch : fetch;
    var res = await fetchFn(API_URL, {
      method: 'POST', body: JSON.stringify(payload),
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }
    }, { timeout: 30000, retries: 1 });
    var text = await res.text();
    var data = JSON.parse(text);
    if (data.success) {
      showToast('Approved. Production can now edit.', 'success');
      await loadEditRequestsList();
      refreshEditReqBadge();
    } else showToast('Failed: ' + (data.error || 'Unknown error'), 'danger');
  } catch(err) { showToast('Error: ' + err.message, 'danger'); }
}

async function rejectEditReqAction(editReqId) {
  if (!editReqId) return;
  var reason = prompt('Why are you rejecting this edit request?', '');
  if (reason === null) return;
  reason = String(reason).trim();
  if (!reason) { showToast('Rejection reason is required', 'warning'); return; }
  try {
    var payload = { action: 'rejectEditRequest', editReqId: editReqId, approver: _editReqState.currentUser, reason: reason };
    var fetchFn = (typeof safeFetch === 'function') ? safeFetch : fetch;
    var res = await fetchFn(API_URL, {
      method: 'POST', body: JSON.stringify(payload),
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }
    }, { timeout: 30000, retries: 1 });
    var text = await res.text();
    var data = JSON.parse(text);
    if (data.success) {
      showToast('Edit request rejected.', 'info');
      await loadEditRequestsList();
      refreshEditReqBadge();
    } else showToast('Failed: ' + (data.error || 'Unknown error'), 'danger');
  } catch(err) { showToast('Error: ' + err.message, 'danger'); }
}

// ═══════════════════════════════════════════════════════════════
// PRODUCTION SIDE
// ═══════════════════════════════════════════════════════════════

async function _getMyEditMap() {
  try {
    var url = API_URL + '?action=getMyEditRequests&requestor=' +
              encodeURIComponent(_editReqState.currentUser) + '&_t=' + Date.now();
    var fetchFn = (typeof safeFetch === 'function') ? safeFetch : fetch;
    var res = await fetchFn(url, { redirect: 'follow' }, { timeout: 15000, retries: 1 });
    var text = await res.text();
    var data = JSON.parse(text);
    if (data.success) return data.map || {};
    return {};
  } catch(e) { return {}; }
}

window.openRequestEditModal = async function(docNo, docType) {
  if (!docNo) return;
  docNo = String(docNo).trim();
  docType = String(docType || 'MRIF').toUpperCase();

  _editReqState.currentUser = localStorage.getItem('ivm_username') || '';
  _editReqState.currentFullname = localStorage.getItem('ivm_userFullname') || _editReqState.currentUser;

  try {
    var permUrl = API_URL + '?action=getDocEditPermission&docNo=' + encodeURIComponent(docNo) + '&_t=' + Date.now();
    var fetchFn = (typeof safeFetch === 'function') ? safeFetch : fetch;
    var permRes = await fetchFn(permUrl, { redirect: 'follow' }, { timeout: 15000, retries: 1 });
    var permText = await permRes.text();
    var permData = JSON.parse(permText);
    if (!permData.success || !permData.hasPermission) {
      showToast('Edit permission not granted yet. Please request edit first.', 'warning');
      return;
    }
  } catch(e) {
    showToast('Could not verify edit permission', 'danger');
    return;
  }

  var modalEl = document.getElementById('editRequestModal');
  if (!modalEl) { showToast('Edit modal not found', 'danger'); return; }
  var modal = bootstrap.Modal.getOrCreateInstance(modalEl);

  document.getElementById('editReqDocNo').value = docNo;
  document.getElementById('editReqDocType').value = docType;
  document.getElementById('editReqHeader').innerHTML = '<i class="bi bi-pencil-square me-2"></i>Editing ' + _editReqEsc(docNo) + ' <span class="badge bg-secondary ms-1">' + _editReqEsc(docType) + '</span>';
  document.getElementById('editReqItemsBody').innerHTML = '<tr><td colspan="7" class="text-center py-3"><div class="spinner-border spinner-border-sm text-primary"></div></td></tr>';
  modal.show();

  try {
    var sheetKey = 'sheetId_' + docType;
    var sheetIdVal = localStorage.getItem(sheetKey);
    var sheetIdClean = sheetIdVal ? extractSheetId(sheetIdVal) : '';
    var url = API_URL + '?action=getDocItems&docNo=' + encodeURIComponent(docNo) +
              '&docType=' + docType +
              '&sheetId=' + encodeURIComponent(sheetIdClean) +
              '&_t=' + Date.now();
    var fetchFn2 = (typeof safeFetch === 'function') ? safeFetch : fetch;
    var res = await fetchFn2(url, { redirect: 'follow' }, { timeout: 20000, retries: 1 });
    var text = await res.text();
    var data = JSON.parse(text);
    if (!data.success) throw new Error(data.error || 'Failed to load document');

    var info = data.info || {};
    var items = data.items || [];

    document.getElementById('editReqRequestor').value = info.Requestor || info.requestor || '';
    document.getElementById('editReqDepartment').value = info.Department || info.department || '';
    document.getElementById('editReqJoNo').value = info['JO No.'] || info.joNo || '';
    document.getElementById('editReqGemSoNo').value = info['GEM SO No.'] || info.gemSoNo || '';
    document.getElementById('editReqClient').value = info['Client Name'] || info.clientName || '';
    document.getElementById('editReqProject').value = info.Project || info.project || '';

    if (typeof loadRequestInventory === 'function' && (!state.requestInventoryList || state.requestInventoryList.length === 0)) {
      loadRequestInventory().catch(function() {});
    }

    _editReqState.items = items.map(function(it) {
      return {
        inventoryId: it.inventoryId || it.itemCode || '',
        description: it.description || '',
        qty: Number(it.qty || it.requestedQty || it.expectedQty || 0),
        unit: it.unit || 'PCS',
        remarks: ''
      };
    });

    renderEditReqItems();
  } catch(err) {
    document.getElementById('editReqItemsBody').innerHTML =
      '<tr><td colspan="7" class="text-center py-3 text-danger">Failed to load: ' + _editReqEsc(err.message) + '</td></tr>';
  }
};

function renderEditReqItems() {
  var tbody = document.getElementById('editReqItemsBody');
  if (!tbody) return;
  var items = _editReqState.items || [];

  if (items.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-center py-3 text-muted">No items. Click "Add Item" below.</td></tr>';
    return;
  }

  var html = '';
  for (var i = 0; i < items.length; i++) {
    var it = items[i];
    html += '<tr data-idx="' + i + '">' +
      '<td class="text-center">' + (i + 1) + '</td>' +
      '<td>' +
        '<div style="position:relative;">' +
          '<input type="text" class="form-control form-control-sm edit-req-code-search" placeholder="Search item..." value="' + _editReqEsc(it.inventoryId ? (it.inventoryId + ' - ' + it.description) : '') + '" oninput="editReqFilterSuggest(this,' + i + ')" onfocus="editReqFilterSuggest(this,' + i + ')" autocomplete="off" style="min-width:180px;">' +
          '<div class="list-group d-none edit-req-dropdown" id="editReqDropdown' + i + '" style="position:fixed;z-index:99999;box-shadow:0 8px 24px rgba(0,0,0,0.18);max-height:260px;overflow-y:auto;"></div>' +
          '<input type="hidden" class="edit-req-code" value="' + _editReqEsc(it.inventoryId) + '">' +
          '<input type="hidden" class="edit-req-desc-hidden" value="' + _editReqEsc(it.description) + '">' +
        '</div>' +
      '</td>' +
      '<td><input type="text" class="form-control form-control-sm edit-req-desc" value="' + _editReqEsc(it.description) + '" oninput="editReqUpdateItem(' + i + ', \'description\', this.value)"></td>' +
      '<td><input type="number" class="form-control form-control-sm text-center edit-req-qty" value="' + it.qty + '" min="1" oninput="editReqUpdateItem(' + i + ', \'qty\', parseInt(this.value)||0)" style="width:80px;"></td>' +
      '<td><select class="form-select form-select-sm edit-req-unit" onchange="editReqUpdateItem(' + i + ', \'unit\', this.value)">' + _editReqUnitOptions(it.unit) + '</select></td>' +
      '<td><input type="text" class="form-control form-control-sm edit-req-remarks" value="' + _editReqEsc(it.remarks || '') + '" placeholder="Optional" oninput="editReqUpdateItem(' + i + ', \'remarks\', this.value)"></td>' +
      '<td class="text-center"><button class="btn btn-sm btn-outline-danger" onclick="editReqRemoveItem(' + i + ')" title="Remove"><i class="bi bi-trash"></i></button></td>' +
    '</tr>';
  }
  tbody.innerHTML = html;
}

window.editReqUpdateItem = function(idx, field, value) {
  if (_editReqState.items[idx]) _editReqState.items[idx][field] = value;
};

window.editReqRemoveItem = function(idx) {
  if (idx < 0 || idx >= _editReqState.items.length) return;
  _editReqState.items.splice(idx, 1);
  renderEditReqItems();
};

window.editReqAddItem = function() {
  _editReqState.items = _editReqState.items || [];
  _editReqState.items.push({ inventoryId: '', description: '', qty: 1, unit: 'PIECE', remarks: '' });
  renderEditReqItems();
  setTimeout(function() {
    var inputs = document.querySelectorAll('.edit-req-code-search');
    if (inputs.length > 0) inputs[inputs.length - 1].focus();
  }, 100);
};

window.editReqFilterSuggest = function(input, idx) {
  var term = String(input.value || '').toLowerCase().trim();
  var dropdown = document.getElementById('editReqDropdown' + idx);
  if (!dropdown) return;

  if (!term) { dropdown.classList.add('d-none'); return; }

  var list = (typeof state !== 'undefined' && state.requestInventoryList) ? state.requestInventoryList : [];
  var matches = list.filter(function(it) {
    var c = (it.code || it.inventoryId || '').toLowerCase();
    var d = (it.description || '').toLowerCase();
    return c.indexOf(term) !== -1 || d.indexOf(term) !== -1;
  }).slice(0, 20);

  dropdown.innerHTML = '';
  if (matches.length === 0) {
    dropdown.innerHTML = '<div class="list-group-item text-muted small" style="padding:8px 12px;">No matches — you can type manually</div>';
  } else {
    matches.forEach(function(it) {
      var code = it.code || it.inventoryId || '';
      var desc = it.description || '';
      var unit = it.unit || 'PIECE';
      var el = document.createElement('div');
      el.className = 'list-group-item list-group-item-action';
      el.style.cssText = 'padding:10px 14px;cursor:pointer;font-size:0.9rem;border-bottom:1px solid #f0f0f0;background:#fff;';
      el.innerHTML = '<div class="fw-bold" style="color:#1e3a5f;">' + _editReqEsc(code) + '</div><div class="text-muted small">' + _editReqEsc(desc) + ' <span class="badge bg-light text-dark">' + _editReqEsc(unit) + '</span></div>';
      el.onmousedown = function(e) {
        e.preventDefault();
        selectEditReqItem(idx, code, desc, unit);
        dropdown.classList.add('d-none');
      };
      dropdown.appendChild(el);
    });
  }

  var rect = input.getBoundingClientRect();
  dropdown.style.left = rect.left + 'px';
  dropdown.style.width = Math.max(rect.width, 300) + 'px';
  var below = window.innerHeight - rect.bottom;
  if (below < 240 && rect.top > below) {
    dropdown.style.top = 'auto';
    dropdown.style.bottom = (window.innerHeight - rect.top + 2) + 'px';
  } else {
    dropdown.style.bottom = 'auto';
    dropdown.style.top = (rect.bottom + 2) + 'px';
  }
  dropdown.classList.remove('d-none');
};

function selectEditReqItem(idx, code, desc, unit) {
  if (!_editReqState.items[idx]) return;
  _editReqState.items[idx].inventoryId = code;
  _editReqState.items[idx].description = desc;
  _editReqState.items[idx].unit = unit || 'PIECE';
  renderEditReqItems();
}

window.submitEditedRequest = async function() {
  var docNo = document.getElementById('editReqDocNo').value;
  var docType = document.getElementById('editReqDocType').value;
  if (!docNo) return;

  var items = (_editReqState.items || []).filter(function(it) {
    return it.inventoryId && it.inventoryId.trim() && it.qty > 0;
  });
  if (items.length === 0) { showToast('Please keep at least one valid item', 'warning'); return; }

  var btn = document.getElementById('editReqSubmitBtn');
  var origHtml = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.classList.add('btn-loading');
    btn.innerHTML = '<span class="btn-spinner"></span>Saving...';
  }

  try {
    var payload = {
      action: 'applyRequestEdit',
      docNo: docNo,
      docType: docType,
      editedBy: _editReqState.currentUser,
      updates: {
        items: items,
        requestor: document.getElementById('editReqRequestor').value.trim(),
        department: document.getElementById('editReqDepartment').value.trim(),
        joNo: document.getElementById('editReqJoNo').value.trim(),
        gemSoNo: document.getElementById('editReqGemSoNo').value.trim(),
        clientName: document.getElementById('editReqClient').value.trim(),
        project: document.getElementById('editReqProject').value.trim()
      }
    };
    var fetchFn = (typeof safeFetch === 'function') ? safeFetch : fetch;
    var res = await fetchFn(API_URL, {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }
    }, { timeout: 60000, retries: 1 });
    var text = await res.text();
    var data = JSON.parse(text);

    if (data.success) {
      var modalEl = document.getElementById('editRequestModal');
      if (modalEl) {
        var m = bootstrap.Modal.getInstance(modalEl);
        if (m) m.hide();
      }
      showToast('Request updated successfully.', 'success');
      if (typeof loadMyRequests === 'function') loadMyRequests();
    } else {
      showToast('Failed: ' + (data.error || 'Unknown error'), 'danger');
    }
  } catch(err) {
    showToast('Error: ' + err.message, 'danger');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.classList.remove('btn-loading');
      btn.innerHTML = origHtml;
    }
  }
};

window.requestEditPermissionFromUser = async function(docNo, docType) {
  if (!docNo) return;
  var reason = prompt('Why do you need to edit this request?', '');
  if (reason === null) return;
  reason = String(reason).trim();
  if (!reason) { showToast('Reason is required', 'warning'); return; }

  _editReqState.currentUser = localStorage.getItem('ivm_username') || '';
  _editReqState.currentFullname = localStorage.getItem('ivm_userFullname') || _editReqState.currentUser;

  try {
    var payload = {
      action: 'requestEditPermission',
      docNo: docNo,
      docType: docType || 'MRIF',
      requestedBy: _editReqState.currentUser,
      requestedByFullname: _editReqState.currentFullname,
      reason: reason
    };
    var fetchFn = (typeof safeFetch === 'function') ? safeFetch : fetch;
    var res = await fetchFn(API_URL, {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }
    }, { timeout: 30000, retries: 1 });
    var text = await res.text();
    var data = JSON.parse(text);
    if (data.success) {
      showToast('Edit requested. Warehouse will review shortly.', 'success');
      if (typeof loadMyRequests === 'function') loadMyRequests();
    } else {
      showToast(data.error || 'Failed to request edit', 'danger');
    }
  } catch(err) { showToast('Error: ' + err.message, 'danger'); }
};

function _editReqEsc(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function _editReqUnitOptions(selected) {
  var units = (typeof UNIT_OPTIONS !== 'undefined') ? UNIT_OPTIONS : ['PIECE','PCS','BOX','SET','KG','LITER','METER','ROLL'];
  var html = '';
  units.forEach(function(u) { html += '<option value="' + u + '"' + (u === selected ? ' selected' : '') + '>' + u + '</option>'; });
  return html;
}

console.log('✅ editRequests.js loaded');
