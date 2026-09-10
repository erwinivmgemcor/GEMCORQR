// ============================================================
// CACHE UTILITY – Simple localStorage caching with TTL
// (CACHE_TTL is defined in config.js — DO NOT redeclare here)
// ============================================================

function getCache(key) {
  try {
    var raw = localStorage.getItem('ivm_cache_' + key);
    if (!raw) return null;
    var item = JSON.parse(raw);
    if (Date.now() > item.expires) {
      localStorage.removeItem('ivm_cache_' + key);
      return null;
    }
    return item.data;
  } catch (e) {
    return null;
  }
}

function setCache(key, data, ttl) {
  try {
    var item = {
      data: data,
      expires: Date.now() + ttl
    };
    localStorage.setItem('ivm_cache_' + key, JSON.stringify(item));
  } catch (e) {
    // localStorage full — ignore
    console.warn('[cache] Could not save:', key, e.message);
  }
}

function clearCache(key) {
  if (key) {
    localStorage.removeItem('ivm_cache_' + key);
  } else {
    Object.keys(localStorage).forEach(function(k) {
      if (k.indexOf('ivm_cache_') === 0) localStorage.removeItem(k);
    });
  }
}

function isCacheValid(key) {
  var raw = localStorage.getItem('ivm_cache_' + key);
  if (!raw) return false;
  try {
    var item = JSON.parse(raw);
    return Date.now() <= item.expires;
  } catch (e) {
    return false;
  }
}

// ─── Optional: inspect cache size ───────────────────────
function listCacheKeys() {
  var keys = [];
  Object.keys(localStorage).forEach(function(k) {
    if (k.indexOf('ivm_cache_') === 0) keys.push(k.replace('ivm_cache_', ''));
  });
  return keys;
}
