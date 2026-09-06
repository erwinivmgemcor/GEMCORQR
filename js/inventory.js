// ============================================================
// INVENTORY BROWSER
// ============================================================

var inventoryBrowserModal = null;
var inventoryItemsCache = [];
var inventoryBrowserFiltered = [];

function openInventoryBrowser() {
  if (!inventoryBrowserModal) {
    inventoryBrowserModal = new bootstrap.Modal(document.getElementById('inventoryBrowserModal'));
  }
  document.getElementById('inventorySearchInput').value = '';
  inventoryBrowserModal.show();
  fetchInventoryItems();
}

function openQrZoom(item) {
  if (!qrZoomModal) {
    qrZoomModal = new bootstrap.Modal(document.getElementById('qrZoomModal'));
  }
  document.getElementById('qrZoomCode').textContent = item.inventoryId || item.code || '';
  document.getElementById('qrZoomDesc').textContent = item.description || '';
  
  var qrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=' + encodeURIComponent(item.inventoryId || item.code || '');
  document.getElementById('qrZoomImg').src = qrUrl;
  document.getElementById('qrZoomImg').onerror = function() {
    this.style.display = 'none';
    document.getElementById('qrZoomFallback').classList.remove('d-none');
  };
  document.getElementById('qrZoomFallback').classList.add('d-none');
  document.getElementById('qrZoomImg').style.display = 'block';
  
  qrZoomModal.show();
}

async function fetchInventoryItems() {
  var tbody = document.getElementById('inventoryBrowserBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="3" class="text-center py-3"><div class="spinner-border spinner-border-sm text-primary"></div> Loading inventory...</td></tr>';

  try {
    var sheetId = '1HSxuSlik8hvbHppOE56ICzl1Jz9cCxFWCJ4EN-bzVFs';
    var url = API_URL + '?action=getInventoryItems&sheetId=' + sheetId + '&_t=' + Date.now();
    console.log('[fetchInventoryItems] URL:', url);
    var res = await fetch(url, { redirect: 'follow' });
    var text = await res.text();
    console.log('[fetchInventoryItems] Raw response:', text.substring(0, 500));
    var data;
    try { data = JSON.parse(text); } catch(e) { 
      console.error('[fetchInventoryItems] JSON parse error:', e);
      throw new Error('Invalid response from server');
    }

    if (data.success && data.items && data.items.length > 0) {
      inventoryItemsCache = data.items;
      inventoryBrowserFiltered = data.items;
      renderInventoryItems();
      console.log('[fetchInventoryItems] Loaded ' + data.items.length + ' items');
    } else {
      var errorMsg = data.error || 'No items found. Please check that your inventory sheet exists and has data.';
      console.error('[fetchInventoryItems] Error:', errorMsg);
      tbody.innerHTML = '<tr><td colspan="3" class="text-center text-danger py-3">' + errorMsg + '</td></tr>';
    }
  } catch(err) {
    console.error('[fetchInventoryItems] Error:', err);
    tbody.innerHTML = '<tr><td colspan="3" class="text-center text-danger py-3">Failed to load inventory: ' + err.message + '</td></tr>';
  }
}

function renderInventoryItems() {
  var tbody = document.getElementById('inventoryBrowserBody');
  if (!tbody) return;

  if (inventoryBrowserFiltered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="3" class="text-center text-muted py-3">No items match your search</td></tr>';
    return;
  }

  var html = '';
  for (var i = 0; i < inventoryBrowserFiltered.length; i++) {
    var it = inventoryBrowserFiltered[i];
    var qrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=50x50&data=' + encodeURIComponent(it.inventoryId);
    var safeCode = it.inventoryId.replace(/'/g, "\\'");
    var safeDesc = it.description.replace(/'/g, "\\'");
    html += '<tr class="inventory-row" style="cursor:pointer;" onclick="openQrZoom({inventoryId:\'' + safeCode + '\', code:\'' + safeCode + '\', description:\'' + safeDesc + '\'})">' +
      '<td class="align-middle text-center"><img src="' + qrUrl + '" style="width:40px;height:40px;" alt="QR"></td>' +
      '<td class="align-middle"><code>' + it.inventoryId + '</code></td>' +
      '<td class="align-middle">' + it.description + '</td>' +
      '</tr>';
  }
  tbody.innerHTML = html;
}

function filterInventoryItems() {
  var query = document.getElementById('inventorySearchInput').value.toLowerCase().trim();
  if (!query) {
    inventoryBrowserFiltered = inventoryItemsCache;
  } else {
    inventoryBrowserFiltered = inventoryItemsCache.filter(function(it) {
      return (it.inventoryId && it.inventoryId.toLowerCase().indexOf(query) !== -1) ||
             (it.description && it.description.toLowerCase().indexOf(query) !== -1);
    });
  }
  renderInventoryItems();
}

function openInventoryQrScan() {
  state.inventoryScanMode = true;
  openQrScanner();
}
