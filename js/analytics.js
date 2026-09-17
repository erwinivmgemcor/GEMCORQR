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

// ─── Top Requested Items — Doughnut chart with Top N + Others ───
function renderTopItemsChart(topItems) {
  var ctx = _prepChart('topItemsChart', '_topItemsChart');
  if (!ctx) return;

  var container = document.getElementById('topItemsChartContainer');
  if (!topItems || topItems.length === 0) {
    if (container) container.innerHTML = '<div class="text-center text-muted py-4">No item data yet. Items will appear after requests are created.</div>';
    return;
  }

  // ═══════════════════════════════════════════════════════════
  // Group into Top N + Others for readability
  // ═══════════════════════════════════════════════════════════
  var TOP_N = 8;
  var totalRequested = topItems.reduce(function(sum, it) { return sum + (it.count || 0); }, 0);
  var displayed = [];
  var labels = [];
  var counts = [];
  var qtyTotals = [];

  if (topItems.length <= TOP_N + 2) {
    // Few items — show all
    topItems.forEach(function(it) {
      displayed.push(it);
      labels.push(it.itemCode);
      counts.push(it.count);
      qtyTotals.push(it.totalQty || 0);
    });
  } else {
    // Show top N + "Others"
    var topPortion = topItems.slice(0, TOP_N);
    var otherPortion = topItems.slice(TOP_N);

    topPortion.forEach(function(it) {
      displayed.push(it);
      labels.push(it.itemCode);
      counts.push(it.count);
      qtyTotals.push(it.totalQty || 0);
    });

    var otherCount = otherPortion.reduce(function(sum, it) { return sum + (it.count || 0); }, 0);
    var otherQty = otherPortion.reduce(function(sum, it) { return sum + (it.totalQty || 0); }, 0);

    labels.push('Others (' + otherPortion.length + ' items)');
    counts.push(otherCount);
    qtyTotals.push(otherQty);
    displayed.push({ isOther: true, items: otherPortion, count: otherCount, totalQty: otherQty });
  }

  // ─── Color palette ───
  var palette = [
    '#1e3a5f', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6',
    '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#6b7280'
  ];
  var colors = labels.map(function(_, i) { return palette[i % palette.length]; });

  // ─── Custom legend below chart ───
  if (container) {
    var legendHtml = '<div class="chart-pie-legend">';
    displayed.forEach(function(it, idx) {
      if (it.isOther) return; // handled separately
      var pct = totalRequested > 0 ? ((it.count / totalRequested) * 100).toFixed(1) : '0.0';
      legendHtml += '<span class="chart-pie-legend-item">' +
        '<span class="chart-pie-dot" style="background:' + colors[idx] + '"></span>' +
        '<code>' + escapeHtmlSimple(it.itemCode) + '</code>' +
        '<span class="chart-pie-legend-meta">' + it.count + ' · ' + pct + '%</span>' +
        '</span>';
    });
    // If there's an "Others" slice, show a summary line
    var otherSlice = displayed[displayed.length - 1];
    if (otherSlice && otherSlice.isOther) {
      var otherPct = totalRequested > 0 ? ((otherSlice.count / totalRequested) * 100).toFixed(1) : '0.0';
      legendHtml += '<span class="chart-pie-legend-item chart-pie-legend-other">' +
        '<span class="chart-pie-dot" style="background:' + colors[colors.length - 1] + '"></span>' +
        '<em>Others (' + otherSlice.items.length + ' items)</em>' +
        '<span class="chart-pie-legend-meta">' + otherSlice.count + ' · ' + otherPct + '%</span>' +
        '</span>';
    }
    legendHtml += '</div>';
    container.insertAdjacentHTML('afterbegin', legendHtml);
  }

  window._topItemsChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: labels,
      datasets: [{
        data: counts,
        backgroundColor: colors,
        borderColor: '#fff',
        borderWidth: 2,
        hoverOffset: 8
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 400 },
      cutout: '45%',
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: function(context) {
              return context[0].label;
            },
            label: function(context) {
              var i = context.dataIndex;
              var count = counts[i];
              var qty = qtyTotals[i];
              var pct = totalRequested > 0 ? ((count / totalRequested) * 100).toFixed(1) : '0.0';
              var lines = [
                'Times Requested: ' + count + ' (' + pct + '%)',
                'Total Qty: ' + qty
              ];
              if (displayed[i] && displayed[i].isOther) {
                lines.push('Includes ' + displayed[i].items.length + ' item(s)');
              }
              return lines;
            }
          }
        }
      }
    }
  });
}

// ─── Local HTML escape (in case history.js not loaded) ───
function escapeHtmlSimple(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
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
