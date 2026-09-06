// ============================================================
// DASHBOARD ANALYTICS
// ============================================================

var analyticsLoaded = false;

async function loadAnalytics() {
  if (state.isLoading) return;
  var container = document.getElementById('analyticsSection');
  if (!container) return;
  document.getElementById('analyticsLoading').classList.remove('d-none');
  document.getElementById('analyticsContent').classList.add('d-none');

  try {
    var url = API_URL + '?action=getDashboardAnalytics&_t=' + Date.now();
    var res = await fetch(url, { redirect: 'follow' });
    var data = await res.json();
    console.log('[Analytics] Response:', data);

    if (!data.success) {
      showToast('Failed to load analytics: ' + (data.error || 'Unknown error'), 'danger');
      document.getElementById('analyticsLoading').classList.add('d-none');
      return;
    }

    // Update KPI cards
    if (data.totals) {
      document.getElementById('kpiActiveDocs').textContent = data.totals.total || 0;
      document.getElementById('kpiPending').textContent = data.totals.pending || 0;
      document.getElementById('kpiCompleted').textContent = data.totals.completed || 0;
      document.getElementById('kpiNotifications').textContent = data.totals.pending || 0;
    }

    // ─── Render charts ──────────────────────────────
    renderDailyChart(data.dailyRequests || []);
    renderTopItemsChart(data.topItems || []);
    renderStaffChart(data.staffPerformance || []);
    document.getElementById('avgProcessingTime').textContent = data.avgProcessingTime ? data.avgProcessingTime.toFixed(1) + ' days' : 'N/A';

    document.getElementById('analyticsLoading').classList.add('d-none');
    document.getElementById('analyticsContent').classList.remove('d-none');
    analyticsLoaded = true;
  } catch(err) {
    console.error('[Analytics] Error:', err);
    showToast('Failed to load analytics: ' + err.message, 'danger');
    document.getElementById('analyticsLoading').classList.add('d-none');
  }
}

function renderDailyChart(dailyData) {
  var ctx = document.getElementById('dailyChart').getContext('2d');
  var labels = dailyData.map(function(d) { return d.date; });
  var counts = dailyData.map(function(d) { return d.count; });

  if (labels.length === 0) {
    document.getElementById('dailyChartContainer').innerHTML = '<div class="text-center text-muted py-4">No data for the last 30 days</div>';
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
  var ctx = document.getElementById('topItemsChart').getContext('2d');
  var labels = topItems.map(function(d) { return d.itemCode; });
  var counts = topItems.map(function(d) { return d.count; });

  if (labels.length === 0) {
    document.getElementById('topItemsChartContainer').innerHTML = '<div class="text-center text-muted py-4">No item data yet</div>';
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
  var ctx = document.getElementById('staffChart').getContext('2d');
  var labels = staffData.map(function(d) { return d.name; });
  var counts = staffData.map(function(d) { return d.count; });

  if (labels.length === 0) {
    document.getElementById('staffChartContainer').innerHTML = '<div class="text-center text-muted py-4">No staff data yet</div>';
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
