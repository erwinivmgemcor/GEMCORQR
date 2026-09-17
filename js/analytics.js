// ============================================================
// DASHBOARD ANALYTICS — Fixed Chart.js sizing
// ============================================================

var analyticsLoaded = false;
var analyticsRetryCount = 0;
var MAX_ANALYTICS_RETRIES = 3;

// Chart instances
window._dailyChart = null;
window._topItemsChart = null;
window._staffChart = null;
window._requestorChart = null;

// Debounced resize handler
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
    if (loadingEl) loadingEl.classList.add('d-none');
    if (contentEl) contentEl.classList.add('d-none');
    if (errorEl) {
      errorEl.classList.remove('d-none');
      var t = document.getElementById('analyticsErrorText');
      if (t) t.textContent = 'Analytics took too long to load. Click "Refresh" to try again.';
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

    // ─── Totals ───
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

    // ─── Avg processing time ───
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

    // ═══════════════════════════════════════════════════════════
    // SHOW THE CONTENT FIRST — then render charts on next frame
    // (otherwise Chart.js measures a hidden/sized-to-0 container)
    // ═══════════════════════════════════════════════════════════
    if (loadingEl) loadingEl.classList.add('d-none');
    if (contentEl) contentEl.classList.remove('d-none');

    requestAnimationFrame(function() {
      requestAnimationFrame(function() {
        // Now the DOM has settled — render charts
        try { renderDailyChart(data.dailyRequests || []); } catch(e) { console.warn(e); }
        try { renderTopItemsChart(data.topItems || []); } catch(e) { console.warn(e); }
        try { renderStaffChart(data.staffPerformance || []); } catch(e) { console.warn(e); }
        try { renderRequestorChart(data.requestorPerformance || []); } catch(e) { console.warn(e); }

        // Force resize in case containers changed size during render
        setTimeout(function() {
          ['_dailyChart', '_topItemsChart', '_staffChart', '_requestorChart'].forEach(function(k) {
            if (window[k] && typeof window[k].resize === 'function') {
              try { window[k].resize(); } catch(e) {}
            }
          });
        }, 100);
      });
    });

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
      if (t) t.textContent = 'Failed to load analytics: ' + err.message;
    }
    analyticsRetryCount++;
  }
}

// ─── Helper: destroy old + return ctx ───
function _prepChart(canvasId, instanceKey) {
  var canvas = document.getElementById(canvasId);
  if (!canvas) return null;
  if (window[instanceKey]) {
    try { window[instanceKey].destroy(); } catch(e) {}
    window[instanceKey] = null;
  }
  return canvas.getContext('2d');
}

// ─── Daily Request Volume ───
function renderDailyChart(dailyData) {
  var ctx = _prepChart('dailyChart', '_dailyChart');
  if (!ctx) return;

  var container = document.getElementById('dailyChartContainer');
  if (!dailyData || dailyData.length === 0) {
    if (container) container.innerHTML = '<div class="text-center text-muted py-4">No data for the last 30 days</div>';
    return;
  }

  var labels = dailyData.map(function(d) {
    try {
      var parts = d.date.split('-');
      var dt = new Date(parts[0], parts[1] - 1, parts[2]);
      var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      return months[dt.getMonth()] + ' ' + dt.getDate();
    } catch(e) { return d.date; }
  });
  var counts = dailyData.map(function(d) { return d.count; });

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
      animation: { duration: 400 },
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
          title: { display: true, text: 'Requests', font: { size: 10 } }
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
  var ctx = _prepChart('topItemsChart', '_topItemsChart');
  if (!ctx) return;

  var container = document.getElementById('topItemsChartContainer');
  if (!topItems || topItems.length === 0) {
    if (container) container.innerHTML = '<div class="text-center text-muted py-4">No item data yet. Items will appear after requests are created.</div>';
    return;
  }

  var labels = topItems.map(function(d) { return d.itemCode; });
  var counts = topItems.map(function(d) { return d.count; });
  var qtys = topItems.map(function(d) { return d.totalQty || 0; });

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
      animation: { duration: 400 },
      layout: { padding: { right: 20 } },
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
  var ctx = _prepChart('staffChart', '_staffChart');
  if (!ctx) return;

  var container = document.getElementById('staffChartContainer');
  if (!staffData || staffData.length === 0) {
    if (container) container.innerHTML = '<div class="text-center text-muted py-4">No warehouse staff data yet</div>';
    return;
  }

  // Take top 10 only
  var top10 = staffData.slice(0, 10);
  var labels = top10.map(function(d) { return d.name; });
  var counts = top10.map(function(d) { return d.count; });

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
      animation: { duration: 400 },
      layout: { padding: { right: 20 } },
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

// ─── Top Requestors ───
function renderRequestorChart(requestorData) {
  var ctx = _prepChart('requestorChart', '_requestorChart');
  if (!ctx) return;

  var container = document.getElementById('requestorChartContainer');
  if (!requestorData || requestorData.length === 0) {
    if (container) container.innerHTML = '<div class="text-center text-muted py-4">No requestor data yet. Submit a request to see who requests the most.</div>';
    return;
  }

  var top10 = requestorData.slice(0, 10);
  var labels = top10.map(function(d) { return d.name; });
  var counts = top10.map(function(d) { return d.count; });

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
      animation: { duration: 400 },
      layout: { padding: { right: 20 } },
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
