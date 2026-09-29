// ============================================================
// DASHBOARD ANALYTICS — Fixed Chart.js sizing
// ★ v2 — 10 min cache, lazy load only on visible, friendly errors
// ============================================================

var analyticsLoaded = false;
var analyticsRetryCount = 0;
var MAX_ANALYTICS_RETRIES = 3;
var _analyticsFetchPromise = null;

window._dailyChart = null;
window._topItemsChart = null;
window._staffChart = null;
window._requestorChart = null;

var _resizeTimer = null;
window.addEventListener('resize', function() {
  clearTimeout(_resizeTimer);
  _resizeTimer = setTimeout(function() {
    ['_dailyChart', '_topItemsChart', '_staffChart', '_requestorChart'].forEach(function(k) {
      if (window[k] && typeof window[k].resize === 'function') {
        try { window[k].resize(); } catch(e) {}
      }
    });
  }, 250);
});

async function loadAnalytics(forceRefresh) {
  if (state.isLoading) return;
  var container = document.getElementById('analyticsSection');
  if (!container) return;

  var dashboard = document.getElementById('section-dashboard');
  if (!dashboard || !dashboard.classList.contains('active')) return;

  // ★ Use cache unless forced
  var cacheKey = 'analyticsData';
  if (!forceRefresh) {
    var cached = (typeof getCache === 'function') ? getCache(cacheKey) : null;
    if (cached) {
      renderAnalytics(cached);
      analyticsLoaded = true;
      return;
    }
  }

  // ★ Prevent duplicate in-flight requests
  if (_analyticsFetchPromise) return _analyticsFetchPromise;

  var loadingEl = document.getElementById('analyticsLoading');
  var contentEl = document.getElementById('analyticsContent');
  var errorEl = document.getElementById('analyticsError');
  if (loadingEl) loadingEl.classList.remove('d-none');
  if (contentEl) contentEl.classList.add('d-none');
  if (errorEl) errorEl.classList.add('d-none');

  var timeoutId = setTimeout(function() {
    if (loadingEl) loadingEl.classList.add('d-none');
    if (contentEl) contentEl.classList.add('d-none');
    if (errorEl) {
      errorEl.classList.remove('d-none');
      var t = document.getElementById('analyticsErrorText');
      if (t) t.textContent = 'Analytics is taking longer than usual. Click "Retry" in a moment.';
    }
  }, 30000);   // ★ was 10s, now 30s

  _analyticsFetchPromise = (async function() {
    try {
var data = await sbGetDashboardAnalytics();
if (!data.success) throw new Error(data.error || 'Unknown error');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var text = await res.text();
      var trimmed = String(text || '').trim();
      if (!trimmed || trimmed.charAt(0) === '<') throw new Error('Server busy');
      var data = JSON.parse(trimmed);

      clearTimeout(timeoutId);
      if (!data.success) throw new Error(data.error || 'Unknown error');

      // ★ Save to cache
      if (typeof setCache === 'function') setCache(cacheKey, data, CACHE_TTL.ANALYTICS);

      renderAnalytics(data);
      analyticsLoaded = true;
      analyticsRetryCount = 0;
    } catch(err) {
      console.error('[Analytics] Error:', err);
      clearTimeout(timeoutId);
      if (loadingEl) loadingEl.classList.add('d-none');
      if (contentEl) contentEl.classList.add('d-none');
      if (errorEl) {
        errorEl.classList.remove('d-none');
        var t = document.getElementById('analyticsErrorText');
        if (t) {
          var msg = err.message || 'Unknown error';
          if (msg.indexOf('HTTP') !== -1 || msg.indexOf('busy') !== -1) {
            t.textContent = 'The server is a bit busy. Please click Retry in a moment.';
          } else {
            t.textContent = 'Failed to load analytics: ' + msg;
          }
        }
      }
      analyticsRetryCount++;
    } finally {
      _analyticsFetchPromise = null;
    }
  })();

  return _analyticsFetchPromise;
}

function renderAnalytics(data) {
  var loadingEl = document.getElementById('analyticsLoading');
  var contentEl = document.getElementById('analyticsContent');
  var errorEl = document.getElementById('analyticsError');

  if (loadingEl) loadingEl.classList.add('d-none');
  if (contentEl) contentEl.classList.remove('d-none');
  if (errorEl) errorEl.classList.add('d-none');

  var totals = data.totals || {};
  var kpis = {
    'kpiActiveDocs': totals.total || 0,
    'kpiPending': totals.pending || 0,
    'kpiCompleted': totals.completed || 0,
    'kpiNotifications': totals.pending || 0
  };
  for (var id in kpis) {
    var el = document.getElementById(id);
    if (el) el.textContent = kpis[id];
  }
  var elMRIF = document.getElementById('kpiMRIFCount');
  var elMRR = document.getElementById('kpiMRRCount');
  var elMRS = document.getElementById('kpiMRSCount');
  if (elMRIF) elMRIF.textContent = totals.mrif || 0;
  if (elMRR) elMRR.textContent = totals.mrr || 0;
  if (elMRS) elMRS.textContent = totals.mrs || 0;

  var avgEl = document.getElementById('avgProcessingTime');
  var avgSubEl = document.getElementById('avgProcessingSub');
  if (avgEl) {
    var avgHours = Number(data.avgProcessingTimeHours || 0);
    var avgDays = Number(data.avgProcessingTime || 0);
    if (avgHours === 0) {
      avgEl.textContent = '0h';
      if (avgSubEl) avgSubEl.textContent = 'No completed requests yet';
    } else if (avgHours < 1) {
      avgEl.textContent = Math.round(avgHours * 60) + ' min';
      if (avgSubEl) avgSubEl.textContent = 'Average time from request to completion';
    } else if (avgHours < 24) {
      avgEl.textContent = avgHours.toFixed(1) + ' hrs';
      if (avgSubEl) avgSubEl.textContent = 'Average time from request to completion';
    } else {
      avgEl.textContent = avgDays.toFixed(1) + ' days';
      if (avgSubEl) avgSubEl.textContent = 'Average time from request to completion';
    }
  }

  requestAnimationFrame(function() {
    requestAnimationFrame(function() {
      try { renderDailyChart(data.dailyRequests || []); } catch(e) { console.warn(e); }
      try { renderTopItemsChart(data.topItems || []); } catch(e) { console.warn(e); }
      try { renderStaffChart(data.staffPerformance || []); } catch(e) { console.warn(e); }
      try { renderRequestorChart(data.requestorPerformance || []); } catch(e) { console.warn(e); }
      setTimeout(function() {
        ['_dailyChart', '_topItemsChart', '_staffChart', '_requestorChart'].forEach(function(k) {
          if (window[k] && typeof window[k].resize === 'function') {
            try { window[k].resize(); } catch(e) {}
          }
        });
      }, 100);
    });
  });
}

function _prepChart(canvasId, instanceKey) {
  var canvas = document.getElementById(canvasId);
  if (!canvas) return null;
  if (window[instanceKey]) {
    try { window[instanceKey].destroy(); } catch(e) {}
    window[instanceKey] = null;
  }
  return canvas.getContext('2d');
}

function renderDailyChart(dailyData) {
  var ctx = _prepChart('dailyChart', '_dailyChart');
  if (!ctx) return;
  if (!dailyData || dailyData.length === 0) return;

  var labels = dailyData.map(function(d) {
    try {
      var parts = d.date.split('-');
      var dt = new Date(parts[0], parts[1] - 1, parts[2]);
      var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      return months[dt.getMonth()] + ' ' + dt.getDate();
    } catch(e) { return d.date; }
  });

  var mrifCounts = dailyData.map(function(d) { return d.mrif || 0; });
  var mrrCounts  = dailyData.map(function(d) { return d.mrr  || 0; });
  var mrsCounts  = dailyData.map(function(d) { return d.mrs  || 0; });

  window._dailyChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [
        { label: 'MRIF (Requests)', data: mrifCounts, borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,0.10)', fill: false, tension: 0.3, pointBackgroundColor: '#f59e0b', pointRadius: 3, borderWidth: 2.5 },
        { label: 'MRR (Receiving)', data: mrrCounts, borderColor: '#2e8b57', backgroundColor: 'rgba(46,139,87,0.10)', fill: false, tension: 0.3, pointBackgroundColor: '#2e8b57', pointRadius: 3, borderWidth: 2.5 },
        { label: 'MRS (Returns)', data: mrsCounts, borderColor: '#dc3545', backgroundColor: 'rgba(220,53,69,0.10)', fill: false, tension: 0.3, pointBackgroundColor: '#dc3545', pointRadius: 3, borderWidth: 2.5 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: { duration: 400 },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: true, position: 'top', labels: { boxWidth: 12, boxHeight: 12, padding: 12, font: { size: 11, weight: '600' }, usePointStyle: true, pointStyle: 'circle' } }
      },
      scales: {
        y: { beginAtZero: true, ticks: { stepSize: 1, precision: 0 } },
        x: { ticks: { autoSkip: true, maxTicksLimit: 10, font: { size: 10 } } }
      }
    }
  });
}

function renderTopItemsChart(topItems) {
  var ctx = _prepChart('topItemsChart', '_topItemsChart');
  if (!ctx) return;
  var legendEl = document.getElementById('topItemsLegend');
  if (legendEl) legendEl.innerHTML = '';
  if (!topItems || topItems.length === 0) {
    if (legendEl) legendEl.innerHTML = '<div class="text-muted small py-1">No item data yet.</div>';
    return;
  }

  var TOP_N = 8;
  var totalRequested = topItems.reduce(function(sum, it) { return sum + (it.count || 0); }, 0);
  var slices = [];
  var labels = [];
  var counts = [];
  var qtyTotals = [];

  if (topItems.length <= TOP_N + 2) {
    topItems.forEach(function(it) { slices.push(it); labels.push(it.itemCode); counts.push(it.count); qtyTotals.push(it.totalQty || 0); });
  } else {
    topItems.slice(0, TOP_N).forEach(function(it) { slices.push(it); labels.push(it.itemCode); counts.push(it.count); qtyTotals.push(it.totalQty || 0); });
    var otherPortion = topItems.slice(TOP_N);
    var otherCount = otherPortion.reduce(function(s, it) { return s + (it.count || 0); }, 0);
    var otherQty = otherPortion.reduce(function(s, it) { return s + (it.totalQty || 0); }, 0);
    labels.push('Others'); counts.push(otherCount); qtyTotals.push(otherQty);
    slices.push({ isOther: true, items: otherPortion, count: otherCount, totalQty: otherQty, itemCode: 'Others (' + otherPortion.length + ' items)' });
  }

  var palette = ['#1e3a5f','#f59e0b','#10b981','#ef4444','#8b5cf6','#06b6d4','#ec4899','#84cc16','#f97316','#6b7280'];
  var colors = labels.map(function(_, i) { return palette[i % palette.length]; });

  if (legendEl) {
    var html = '';
    slices.forEach(function(it, idx) {
      var pct = totalRequested > 0 ? ((it.count / totalRequested) * 100).toFixed(1) : '0.0';
      html += '<span class="chart-pie-legend-item"><span class="chart-pie-dot" style="background:' + colors[idx] + '"></span><code>' + escapeHtmlSimple(it.itemCode) + '</code><span class="chart-pie-legend-meta">' + it.count + ' · ' + pct + '%</span></span>';
    });
    legendEl.innerHTML = html;
  }

  window._topItemsChart = new Chart(ctx, {
    type: 'doughnut',
    data: { labels: labels, datasets: [{ data: counts, backgroundColor: colors, borderColor: '#fff', borderWidth: 2, hoverOffset: 8 }] },
    options: {
      responsive: true, maintainAspectRatio: false, animation: { duration: 400 }, cutout: '45%',
      plugins: { legend: { display: false } }
    }
  });
}

function escapeHtmlSimple(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderStaffChart(staffData) {
  var ctx = _prepChart('staffChart', '_staffChart');
  if (!ctx) return;
  if (!staffData || staffData.length === 0) return;
  var top10 = staffData.slice(0, 10);
  window._staffChart = new Chart(ctx, {
    type: 'bar',
    data: { labels: top10.map(function(d) { return d.name; }), datasets: [{ label: 'Documents Processed', data: top10.map(function(d) { return d.count; }), backgroundColor: '#2e8b57', borderRadius: 4 }] },
    options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, animation: { duration: 400 }, layout: { padding: { right: 20 } }, plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, ticks: { stepSize: 1, precision: 0 } } } }
  });
}

function renderRequestorChart(requestorData) {
  var ctx = _prepChart('requestorChart', '_requestorChart');
  if (!ctx) return;
  if (!requestorData || requestorData.length === 0) return;
  var top10 = requestorData.slice(0, 10);
  window._requestorChart = new Chart(ctx, {
    type: 'bar',
    data: { labels: top10.map(function(d) { return d.name; }), datasets: [{ label: 'Requests Made', data: top10.map(function(d) { return d.count; }), backgroundColor: '#2563eb', borderRadius: 4 }] },
    options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, animation: { duration: 400 }, layout: { padding: { right: 20 } }, plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, ticks: { stepSize: 1, precision: 0 } } } }
  });
}
