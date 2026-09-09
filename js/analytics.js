// ============================================================
// DASHBOARD ANALYTICS
// ============================================================

var analyticsLoaded = false;
var analyticsRetryCount = 0;
var MAX_ANALYTICS_RETRIES = 3;

async function loadAnalytics() {
  if (state.isLoading) return;
  var container = document.getElementById('analyticsSection');
  if (!container) return;

  // Only load if dashboard is active
  var dashboard = document.getElementById('section-dashboard');
  if (!dashboard || !dashboard.classList.contains('active')) {
    console.log('[Analytics] Dashboard not active, skipping load.');
    return;
  }

  // Show loading, hide content and error
  var loadingEl = document.getElementById('analyticsLoading');
  var contentEl = document.getElementById('analyticsContent');
  var errorEl = document.getElementById('analyticsError');
  if (loadingEl) loadingEl.classList.remove('d-none');
  if (contentEl) contentEl.classList.add('d-none');
  if (errorEl) errorEl.classList.add('d-none');

  // ─── Safety timeout ──────────────────────────────────────
  var timeoutId = setTimeout(function() {
    console.warn('[Analytics] Load timeout – forcing hide.');
    if (loadingEl) loadingEl.classList.add('d-none');
    if (contentEl) contentEl.classList.add('d-none');
    if (errorEl) {
      errorEl.classList.remove('d-none');
      var errText = document.getElementById('analyticsErrorText');
      if (errText) errText.textContent = 'Analytics took too long to load. Click "Refresh" to try again.';
    }
  }, 10000);

  try {
    var url = API_URL + '?action=getDashboardAnalytics&_t=' + Date.now();
    console.log('[Analytics] Fetching:', url);
    var res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    var data = await res.json();
    console.log('[Analytics] Response:', data);

    clearTimeout(timeoutId);

    if (!data.success) {
      throw new Error(data.error || 'Unknown error');
    }

    // ─── Update KPI cards (with null checks) ──────────────
    var kpis = {
      'kpiActiveDocs': data.totals ? data.totals.total : 0,
      'kpiPending': data.totals ? data.totals.pending : 0,
      'kpiCompleted': data.totals ? data.totals.completed : 0,
      'kpiNotifications': data.totals ? data.totals.pending : 0
    };
    for (var id in kpis) {
      var el = document.getElementById(id);
      if (el) el.textContent = kpis[id];
    }

    // ─── Render charts (only if canvases exist) ────────────
    var dailyCanvas = document.getElementById('dailyChart');
    var topItemsCanvas = document.getElementById('topItemsChart');
    var staffCanvas = document.getElementById('staffChart');

    if (dailyCanvas) renderDailyChart(data.dailyRequests || []);
    else console.warn('[Analytics] dailyChart canvas not found');

    if (topItemsCanvas) renderTopItemsChart(data.topItems || []);
    else console.warn('[Analytics] topItemsChart canvas not found');

    if (staffCanvas) renderStaffChart(data.staffPerformance || []);
    else console.warn('[Analytics] staffChart canvas not found');

    var avgEl = document.getElementById('avgProcessingTime');
    if (avgEl) avgEl.textContent = data.avgProcessingTime ? data.avgProcessingTime.toFixed(1) + ' days' : 'N/A';

    if (loadingEl) loadingEl.classList.add('d-none');
    if (contentEl) contentEl.classList.remove('d-none');
    if (errorEl) errorEl.classList.add('d-none');
    analyticsLoaded = true;
    analyticsRetryCount = 0;
  } catch(err) {
    console.error('[Analytics] Error:', err);
    clearTimeout(timeoutId);
    if (loadingEl) loadingEl.classList.add('d-none');
    if (contentEl) contentEl.classList.add('d-none');
    if (errorEl) {
      errorEl.classList.remove('d-none');
      var errText = document.getElementById('analyticsErrorText');
      if (errText) errText.textContent = 'Failed to load analytics: ' + err.message;
    }
    analyticsRetryCount++;
  }
}

function renderDailyChart(dailyData) {
  var canvas = document.getElementById('dailyChart');
  if (!canvas) return;
  var ctx = canvas.getContext('2d');
  var labels = dailyData.map(function(d) { return d.date; });
  var counts = dailyData.map(function(d) { return d.count; });

  var container = document.getElementById('dailyChartContainer');
  if (labels.length === 0) {
    if (container) container.innerHTML = '<div class="text-center text-muted py-4">No data for the last 30 days</div>';
    return;
  }

  if (window._dailyChart) window._dailyChart.destroy();
  window._dailyChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: 'Requests per Day',
        data: counts,
        borderColor: '#1e3a5f',
        backgroundColor: 'rgba(30, 58, 95, 0.1)',
        fill: true,
        tension: 0.3,
        pointBackgroundColor: '#1e3a5f',
        pointRadius: 3
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      },
      scales: {
        y: { beginAtZero: true, ticks: { stepSize: 1 } }
      }
    }
  });
}

function renderTopItemsChart(topItems) {
  var canvas = document.getElementById('topItemsChart');
  if (!canvas) return;
  var ctx = canvas.getContext('2d');
  var labels = topItems.map(function(d) { return d.itemCode; });
  var counts = topItems.map(function(d) { return d.count; });

  var container = document.getElementById('topItemsChartContainer');
  if (labels.length === 0) {
    if (container) container.innerHTML = '<div class="text-center text-muted py-4">No item data yet</div>';
    return;
  }

  if (window._topItemsChart) window._topItemsChart.destroy();
  window._topItemsChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: 'Request Count',
        data: counts,
        backgroundColor: '#f59e0b',
        borderRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      },
      scales: {
        y: { beginAtZero: true, ticks: { stepSize: 1 } }
      }
    }
  });
}

function renderStaffChart(staffData) {
  var canvas = document.getElementById('staffChart');
  if (!canvas) return;
  var ctx = canvas.getContext('2d');
  var labels = staffData.map(function(d) { return d.name; });
  var counts = staffData.map(function(d) { return d.count; });

  var container = document.getElementById('staffChartContainer');
  if (labels.length === 0) {
    if (container) container.innerHTML = '<div class="text-center text-muted py-4">No staff data yet</div>';
    return;
  }

  if (window._staffChart) window._staffChart.destroy();
  window._staffChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: 'Documents Processed',
        data: counts,
        backgroundColor: '#2e8b57',
        borderRadius: 4
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      },
      scales: {
        x: { beginAtZero: true, ticks: { stepSize: 1 } }
      }
    }
  });
}
