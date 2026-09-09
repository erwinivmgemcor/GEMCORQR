// ============================================================
// CACHE UTILITY – Simple localStorage caching with TTL
// (Uses global CACHE_TTL from config.js)
// ============================================================

function getCache(key) {
  try {
    const raw = localStorage.getItem('ivm_cache_' + key);
    if (!raw) return null;
    const item = JSON.parse(raw);
    if (Date.now() > item.expires) {
      localStorage.removeItem('ivm_cache_' + key);
      return null;
    }
    return item.data;
  } catch(e) {
    return null;
  }
}

function setCache(key, data, ttl) {
  try {
    const item = {
      data: data,
      expires: Date.now() + ttl
    };
    localStorage.setItem('ivm_cache_' + key, JSON.stringify(item));
  } catch(e) {
    // localStorage full – ignore
  }
}

function clearCache(key) {
  if (key) {
    localStorage.removeItem('ivm_cache_' + key);
  } else {
    // Clear all ivm_cache_ keys
    Object.keys(localStorage).forEach(k => {
      if (k.startsWith('ivm_cache_')) localStorage.removeItem(k);
    });
  }
}

function isCacheValid(key) {
  const raw = localStorage.getItem('ivm_cache_' + key);
  if (!raw) return false;
  try {
    const item = JSON.parse(raw);
    return Date.now() <= item.expires;
  } catch(e) {
    return false;
  }
}
