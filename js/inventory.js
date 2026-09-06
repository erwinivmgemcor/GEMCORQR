// ============================================================
// INVENTORY BROWSER
// ============================================================

var inventoryBrowserModal = null;
var inventoryItemsCache = [];
var inventoryBrowserFiltered = [];

// ─── Fallback QR image (data URI for a barcode placeholder) ───
var QR_PLACEHOLDER = "data:image/svg+xml," + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="50" height="50" viewBox="0 0 50 50">' +
  '<rect width="50" height="50" fill="#f0f0f0" rx="4"/>' +
  '<text x="25" y="27" font-family="Arial" font-size="12" fill="#999" text-anchor="middle">QR</text>' +
  '<text x="25" y="40" font-family="Arial" font-size="7" fill="#ccc" text-anchor="middle">❌</text>' +
  '</svg>'
);

function openInventoryBrowser() {
  if (!inventoryBrowserModal) {
    inventoryBrowserModal = new bootstrap.Modal(document.getElementById('inventoryBrowserModal'));
  }
  document.getElementById('inventorySearchInput').value = '';
  inventoryBrowserModal.show();
  fetchInventoryItems();
}

// ─── QR Zoom Modal ───
function openQrZoom(item) {
  if (!qrZoomModal) {
    qrZoomModal = new bootstrap.Modal(document.getElementById('qrZoomModal'));
  }
  document.getElementById('qrZoomCode').textContent = item.inventoryId || item.code || '';
  document.getElementById('qrZoomDesc').textContent = item.description || '';

  var qrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=' + encodeURIComponent(item.inventoryId || item.code || '');
  var img = document.getElementById('qrZoomImg');
  img.src = qrUrl;
  img.onerror = function() {
    // Fallback to placeholder
    this.onerror = null;
    this.src = QR_PLACEHOLDER;
    document.getElementById('qrZoomFallback').classList.remove('d-none');
    document.getElementById('qrZoomFallback').textContent = 'QR unavailable for: ' + (item.inventoryId || item.code);
  };
  document.getElementById('qrZoomFallback').classList.add('d-none');
  img.style.display = 'block';

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
    // Silent fail – don't show a toast on dashboard load
    tbody.innerHTML = '<tr><td colspan="3" class="text-center text-muted py-3">Could not load inventory. Please try again.</td></tr>';
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
    var code = it.inventoryId || it.code || '';
    var desc = it.description || '';
    // QR URL with onerror fallback
    var qrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=50x50&data=' + encodeURIComponent(code);
    var safeCode = code.replace(/'/g, "\\'");
    var safeDesc = desc.replace(/'/g, "\\'");

    html += '<tr class="inventory-row" style="cursor:pointer;" onclick="openQrZoom({inventoryId:\'' + safeCode + '\', code:\'' + safeCode + '\', description:\'' + safeDesc + '\'})">' +
      '<td class="align-middle text-center">' +
        '<img src="' + qrUrl + '" style="width:40px;height:40px;" alt="QR" onerror="this.onerror=null;this.src=\'' + QR_PLACEHOLDER + '\';">' +
      '</td>' +
      '<td class="align-middle"><code>' + code + '</code></td>' +
      '<td class="align-middle">' + desc + '</td>' +
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
