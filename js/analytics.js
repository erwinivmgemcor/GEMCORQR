// ============================================================
// DASHBOARD ANALYTICS (Improved)
// ============================================================

var analyticsLoaded = false;
var analyticsRetryCount = 0;
var MAX_ANALYTICS_RETRIES = 3;

async function loadAnalytics() {
  if (state.isLoading) return;
  var container = document.getElementById('analyticsSection');
  if (!container) return;

  var dashboard = document.getElementById('section-dashboard');
  if (!dashboard || !dashboard.classList.contains('active')) return;

  var loadingEl = document.getElementById('analyticsLoading');
  var contentEl = document.getElementById('analyticsContent');
  var errorEl = document.getElementById('analyticsError');
  if (loadingEl) loadingEl.classList.remove('d-none');
  if (contentEl) contentEl.classList.add('d-none');
  if (errorEl) errorEl.classList.add('d-none');

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
    var res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    var text = await res.text();
    var trimmed = String(text || '').trim();
    if (!trimmed || trimmed.charAt(0) === '<') throw new Error('Server unavailable');
    var data = JSON.parse(trimmed);

    clearTimeout(timeoutId);
    if (!data.success) throw new Error(data.error || 'Unknown error');

    // ─── KPI cards ───
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

    // ─── Extra totals ───
    var elMRIF = document.getElementById('kpiMRIFCount');
    var elMRR = document.getElementById('kpiMRRCount');
    var elMRS = document.getElementById('kpiMRSCount');
    if (elMRIF) elMRIF.textContent = totals.mrif || 0;
    if (elMRR) elMRR.textContent = totals.mrr || 0;
    if (elMRS) elMRS.textContent = totals.mrs || 0;

    // ─── Average processing time ───
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

    // ─── Charts ───
    var dailyCanvas = document.getElementById('dailyChart');
    var topItemsCanvas = document.getElementById('topItemsChart');
    var staffCanvas = document.getElementById('staffChart');
    var requestorCanvas = document.getElementById('requestorChart');

    if (dailyCanvas) renderDailyChart(data.dailyRequests || []);
    if (topItemsCanvas) renderTopItemsChart(data.topItems || []);
    if (staffCanvas) renderStaffChart(data.staffPerformance || []);
    if (requestorCanvas) renderRequestorChart(data.requestorPerformance || []);

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

// ─── Daily Request Volume (30 days, filled) ───
function renderDailyChart(dailyData) {
  var canvas = document.getElementById('dailyChart');
  if (!canvas) return;
  var container = document.getElementById('dailyChartContainer');
  if (!dailyData || dailyData.length === 0) {
    if (container) container.innerHTML = '<div class="text-center text-muted py-4">No data for the last 30 days</div>';
    return;
  }
  var ctx = canvas.getContext('2d');
  var labels = dailyData.map(function(d) {
    // Format "2026-09-16" → "Sep 16"
    try {
      var parts = d.date.split('-');
      var dt = new Date(parts[0], parts[1] - 1, parts[2]);
      var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      return months[dt.getMonth()] + ' ' + dt.getDate();
    } catch(e) { return d.date; }
  });
  var counts = dailyData.map(function(d) { return d.count; });

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
        pointRadius: 3,
        pointHoverRadius: 5
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: function(context) {
              return context.parsed.y + ' request(s)';
            }
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: { stepSize: 1, precision: 0 },
          title: { display: true, text: 'Requests' }
        },
        x: {
          ticks: {
            autoSkip: true,
            maxTicksLimit: 10,
            font: { size: 10 }
          }
        }
      }
    }
  });
}

// ─── Top 10 Most Requested Items ───
function renderTopItemsChart(topItems) {
  var canvas = document.getElementById('topItemsChart');
  if (!canvas) return;
  var container = document.getElementById('topItemsChartContainer');
  if (!topItems || topItems.length === 0) {
    if (container) container.innerHTML = '<div class="text-center text-muted py-4">No item data yet. Items will appear after requests are created.</div>';
    return;
  }
  var ctx = canvas.getContext('2d');
  var labels = topItems.map(function(d) { return d.itemCode; });
  var counts = topItems.map(function(d) { return d.count; });
  var qtys = topItems.map(function(d) { return d.totalQty || 0; });

  if (window._topItemsChart) window._topItemsChart.destroy();
  window._topItemsChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: 'Times Requested',
        data: counts,
        backgroundColor: '#f59e0b',
        borderRadius: 4
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: function(context) {
              var i = context.dataIndex;
              return [
                'Times Requested: ' + counts[i],
                'Total Qty: ' + qtys[i]
              ];
            }
          }
        }
      },
      scales: {
        x: {
          beginAtZero: true,
          ticks: { stepSize: 1, precision: 0 }
        },
        y: {
          ticks: { font: { size: 10 } }
        }
      }
    }
  });
}

// ─── Warehouse Staff Performance ───
function renderStaffChart(staffData) {
  var canvas = document.getElementById('staffChart');
  if (!canvas) return;
  var container = document.getElementById('staffChartContainer');
  if (!staffData || staffData.length === 0) {
    if (container) container.innerHTML = '<div class="text-center text-muted py-4">No warehouse staff data yet</div>';
    return;
  }
  var ctx = canvas.getContext('2d');
  var labels = staffData.map(function(d) { return d.name; });
  var counts = staffData.map(function(d) { return d.count; });

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
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: function(context) {
              return context.parsed.x + ' document(s) processed';
            }
          }
        }
      },
      scales: {
        x: {
          beginAtZero: true,
          ticks: { stepSize: 1, precision: 0 }
        },
        y: { ticks: { font: { size: 10 } } }
      }
    }
  });
}

// ─── Top Requestors (Production) ───
function renderRequestorChart(requestorData) {
  var canvas = document.getElementById('requestorChart');
  if (!canvas) return;
  var container = document.getElementById('requestorChartContainer');
  if (!requestorData || requestorData.length === 0) {
    if (container) container.innerHTML = '<div class="text-center text-muted py-4">No requestor data yet. Submit a request to see who requests the most.</div>';
    return;
  }

  // Take top 10
  var top10 = requestorData.slice(0, 10);
  var ctx = canvas.getContext('2d');
  var labels = top10.map(function(d) { return d.name; });
  var counts = top10.map(function(d) { return d.count; });

  if (window._requestorChart) window._requestorChart.destroy();
  window._requestorChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: 'Requests Made',
        data: counts,
        backgroundColor: '#2563eb',
        borderRadius: 4
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: function(context) {
              return context.parsed.x + ' request(s)';
            }
          }
        }
      },
      scales: {
        x: {
          beginAtZero: true,
          ticks: { stepSize: 1, precision: 0 }
        },
        y: { ticks: { font: { size: 10 } } }
      }
    }
  });
}
