// ============================================================
// SUPABASE API — DOCUMENTS
// v6 — No select clauses (avoids PostgREST parser issues)
// ============================================================

async function sbGetAllPendingDocs(includeCompleted) {
  try {
    var allRows = await sbGetAll('documents', '');
    var rows = (allRows || []).filter(function(r) {
      var s = String(r.status || '').toUpperCase();
      if (includeCompleted) return s === 'PENDING' || s === 'PARTIAL' || s === 'COMPLETED';
      return s === 'PENDING' || s === 'PARTIAL';
    });

    rows.sort(function(a, b) {
      var ta = a.created_at ? new Date(a.created_at).getTime() : 0;
      var tb = b.created_at ? new Date(b.created_at).getTime() : 0;
      return tb - ta;
    });

    var docs = rows.map(function(r) {
      return {
        docNo: r.doc_no, sheetName: r.doc_no,
        docType: String(r.doc_type || '').toUpperCase(),
        status: String(r.status || 'PENDING').toUpperCase(),
        isBal: !!r.is_bal,
        requestor: r.requestor || '',
        department: r.department || '',
        itemSummary: r.item_summary || '',
        timestamp: r.created_at || null,
        processedBy: r.processed_by || '',
        processedAt: r.processed_at || null,
        url: '',
        joNo: r.jo_no || '', gemSoNo: r.gem_so_no || '',
        clientName: r.client_name || '', project: r.project || '',
        poNo: r.po_no || '', vendor: r.vendor || '',
        drNo: r.dr_no || '', receivingSite: r.receiving_site || '',
        preparedBy: r.prepared_by || '',
        datePrepared: r.date_prepared || '',
        receivingDate: r.receiving_date || ''
      };
    });

    return { success: true, documents: docs, total: docs.length };
  } catch (err) {
    console.error('[sbGetAllPendingDocs]', err);
    return { success: false, error: err.message, documents: [] };
  }
}

async function sbGetPendingDocs(docType) {
  try {
    var type = String(docType || 'MRIF').toUpperCase();
    var allRows = await sbGetAll('documents', '');
    var docs = (allRows || []).filter(function(r) {
      var t = String(r.doc_type || '').toUpperCase();
      var s = String(r.status || '').toUpperCase();
      return t === type && (s === 'PENDING' || s === 'PARTIAL');
    }).map(function(r) {
      return {
        docNo: r.doc_no, sheetName: r.doc_no,
        docType: String(r.doc_type || '').toUpperCase(),
        status: String(r.status || 'PENDING').toUpperCase(),
        isBal: !!r.is_bal
      };
    });
    return { success: true, documents: docs };
  } catch (err) {
    console.error('[sbGetPendingDocs]', err);
    return { success: false, error: err.message, documents: [] };
  }
}

async function sbGetDocItems(docNo, docType) {
  try {
    if (!docNo) return { success: false, error: 'docNo required' };
    var docRows = await sbGet('documents', 'doc_no=eq.' + encodeURIComponent(docNo) + '&limit=1');
    if (!docRows || docRows.length === 0) {
      return { success: false, error: 'Document not found: ' + docNo };
    }
    var d = docRows[0];

    var itemRows = await sbGetAll('doc_items', 'doc_no=eq.' + encodeURIComponent(docNo));
    itemRows.sort(function(a, b) {
      return (Number(a.line_no) || 0) - (Number(b.line_no) || 0);
    });

    var items = (itemRows || []).map(function(r) {
      return {
        inventoryId: r.item_code, itemCode: r.item_code,
        description: r.description || '',
        expectedQty: Number(r.requested_qty || 0),
        recQty: Number(r.requested_qty || 0),
        requestedQty: Number(r.requested_qty || 0),
        qty: Number(r.requested_qty || 0),
        actualQty: Number(r.issued_qty || 0),
        atlQty: Number(r.issued_qty || 0),
        issuedQty: Number(r.issued_qty || 0),
        unit: r.unit || 'PIECE',
        remarks: r.remarks || 'PENDING',
        rowIndex: r.row_index || (Number(r.line_no) + 12)
      };
    });

    var info = {
      'Requestor': d.requestor || '',
      'Department': d.department || '',
      'JO No.': d.jo_no || '',
      'GEM SO No.': d.gem_so_no || '',
      'Client Name': d.client_name || '',
      'Project': d.project || '',
      'PO No.': d.po_no || '',
      'PRF No.': d.prf_no || '',
      'Vendor/Client': d.vendor || '',
      'DR No.': d.dr_no || '',
      'Receiving Site': d.receiving_site || 'GEMCOR CATMON',
      'Prepared By': d.prepared_by || '',
      'Date Prepared': d.date_prepared || '',
      'Receiving Date': d.receiving_date || '',
      requestor: d.requestor || '', department: d.department || '',
      joNo: d.jo_no || '', gemSoNo: d.gem_so_no || '',
      clientName: d.client_name || '', project: d.project || '',
      poNo: d.po_no || '', vendor: d.vendor || '',
      drNo: d.dr_no || '', receivingSite: d.receiving_site || 'GEMCOR CATMON',
      preparedBy: d.prepared_by || '',
      datePrepared: d.date_prepared || '', receivingDate: d.receiving_date || ''
    };

    return {
      success: true, info: info, items: items, docNo: docNo,
      status: String(d.status || 'PENDING').toUpperCase(),
      _resolvedFrom: 'supabase'
    };
  } catch (err) {
    console.error('[sbGetDocItems]', err);
    return { success: false, error: err.message };
  }
}

async function sbGetDocStatus(docNo) {
  try {
    if (!docNo) return { success: false, error: 'docNo required' };
    var rows = await sbGet('documents', 'doc_no=eq.' + encodeURIComponent(docNo) + '&limit=1');
    if (!rows || rows.length === 0) return { success: true, status: null };
    return { success: true, status: String(rows[0].status || 'PENDING').toUpperCase() };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function sbGetDocLinkStatus(docNo) {
  var r = await sbGetDocStatus(docNo);
  return r.success ? r.status : null;
}

async function sbGetMyRequests(requestor) {
  try {
    if (!requestor) return { success: false, error: 'requestor required' };
    var allRows = await sbGetAll('documents', '');
    var requests = (allRows || []).filter(function(r) {
      return String(r.requestor || '').toLowerCase() === String(requestor).toLowerCase();
    }).map(function(r) {
      var summary = String(r.item_summary || '');
      var parts = summary.split(' x');
      var firstItem = parts[0] || '';
      var firstQty = parts.length > 1 ? parseInt(parts[1].split(',')[0].trim()) || 0 : 0;
      return {
        docNo: r.doc_no, type: String(r.doc_type || '').toUpperCase(),
        requestor: r.requestor || '',
        status: String(r.status || 'PENDING').toUpperCase(),
        timestamp: r.created_at || null,
        itemCode: firstItem, qty: firstQty, department: ''
      };
    });
    return { success: true, requests: requests };
  } catch (err) {
    console.error('[sbGetMyRequests]', err);
    return { success: false, error: err.message, requests: [] };
  }
}

async function sbGetPartialItems() {
  try {
    var rows = await sbGetAll('partial_items', '');
    var items = (rows || []).filter(function(r) {
      return String(r.status || '').toUpperCase() === 'OPEN';
    }).map(function(r) {
      return {
        id: r.id, originalDocNo: r.original_doc_no,
        balDocNo: r.bal_doc_no || '', docNo: r.original_doc_no,
        itemCode: r.item_code, description: r.description || '',
        requestedQty: Number(r.requested_qty || 0),
        issuedQty: Number(r.issued_qty || 0),
        remainingQty: Number(r.remaining_qty || 0),
        unit: r.unit || 'PCS',
        originalRowIndex: r.original_row_index || 0,
        status: r.status, requestor: r.requestor || '',
        department: r.department || '',
        joNo: r.jo_no || '', gemSoNo: r.gem_so_no || '',
        clientName: r.client_name || '', project: r.project || '',
        createdAt: r.created_at, remarks: 'PARTIAL'
      };
    });
    return { success: true, items: items, total: items.length };
  } catch (err) {
    console.error('[sbGetPartialItems]', err);
    return { success: false, error: err.message, items: [] };
  }
}

async function sbGetPartialDocsByType(docType) {
  try {
    docType = String(docType || 'MRIF').toUpperCase();
    if (['MRIF', 'MRR', 'MRS'].indexOf(docType) === -1) {
      return { success: false, error: 'Invalid docType' };
    }
    var allDocs = await sbGetAll('documents', '');
    var docs = (allDocs || []).filter(function(d) {
      var t = String(d.doc_type || '').toUpperCase();
      var s = String(d.status || '').toUpperCase();
      return t === docType && (s === 'PENDING' || s === 'PARTIAL');
    });

    if (!docs || docs.length === 0) {
      return { success: true, documents: [], total: 0 };
    }

    var allItems = await sbGetAll('doc_items', '');
    var docSet = {};
    docs.forEach(function(d) { docSet[d.doc_no] = true; });
    var items = (allItems || []).filter(function(it) { return docSet[it.doc_no]; });

    var itemsByDoc = {};
    items.forEach(function(it) {
      if (!itemsByDoc[it.doc_no]) itemsByDoc[it.doc_no] = [];
      itemsByDoc[it.doc_no].push(it);
    });

    var results = [];
    docs.forEach(function(d) {
      var docItems = itemsByDoc[d.doc_no] || [];
      if (docItems.length === 0) return;
      var partialCount = 0, totalRemaining = 0;
      var firstPartialCode = '', firstPartialDesc = '';
      docItems.forEach(function(it) {
        var requested = Number(it.requested_qty || 0);
        var issued = Number(it.issued_qty || 0);
        if (requested > 0 && issued < requested) {
          partialCount++;
          totalRemaining += (requested - issued);
          if (!firstPartialCode) {
            firstPartialCode = it.item_code;
            firstPartialDesc = it.description || '';
          }
        }
      });
      if (partialCount > 0) {
        results.push({
          docNo: d.doc_no, docType: docType, isBal: !!d.is_bal,
          status: String(d.status || 'PENDING').toUpperCase(),
          totalItems: docItems.length, partialItems: partialCount,
          remainingQty: totalRemaining,
          firstItemCode: firstPartialCode, firstItemDesc: firstPartialDesc,
          requestor: d.requestor || '', department: d.department || '',
          joNo: d.jo_no || '', gemSoNo: d.gem_so_no || '',
          clientName: d.client_name || '', project: d.project || '',
          vendor: d.vendor || '', poNo: d.po_no || '',
          drNo: d.dr_no || '', receivingSite: d.receiving_site || '',
          preparedBy: d.prepared_by || '',
          datePrepared: d.date_prepared || '',
          receivingDate: d.receiving_date || '',
          created_at: d.created_at || null
        });
      }
    });

    results.sort(function(a, b) {
      var ta = a.created_at ? new Date(a.created_at).getTime() : 0;
      var tb = b.created_at ? new Date(b.created_at).getTime() : 0;
      return tb - ta;
    });
    return { success: true, documents: results, total: results.length };
  } catch (err) {
    console.error('[sbGetPartialDocsByType]', err);
    return { success: false, error: err.message, documents: [] };
  }
}

async function sbGetDashboardAnalytics() {
  try {
    var docs = await sbGetAll('documents', '');
    var now = new Date();
    var thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    var total = 0, pending = 0, completed = 0, partial = 0;
    var mrifCount = 0, mrrCount = 0, mrsCount = 0;
    var staffCounts = {}, requestorCounts = {}, itemCounts = {};
    var processingTimesHours = [];
    var dailyMrif = {}, dailyMrr = {}, dailyMrs = {};

    for (var d = 0; d < 30; d++) {
      var ds = new Date(now.getTime() - d * 86400000).toISOString().slice(0, 10);
      dailyMrif[ds] = 0; dailyMrr[ds] = 0; dailyMrs[ds] = 0;
    }

    (docs || []).forEach(function(r) {
      total++;
      var type = String(r.doc_type || '').toUpperCase();
      var status = String(r.status || 'PENDING').toUpperCase();
      if (type === 'MRIF') mrifCount++;
      else if (type === 'MRR') mrrCount++;
      else if (type === 'MRS') mrsCount++;
      if (status === 'PENDING') pending++;
      else if (status === 'COMPLETED') completed++;
      else if (status === 'PARTIAL') partial++;

      if (r.created_at) {
        var dt = new Date(r.created_at);
        if (!isNaN(dt.getTime()) && dt >= thirtyDaysAgo) {
          var ds2 = dt.toISOString().slice(0, 10);
          if (type === 'MRIF' && dailyMrif[ds2] !== undefined) dailyMrif[ds2]++;
          else if (type === 'MRR' && dailyMrr[ds2] !== undefined) dailyMrr[ds2]++;
          else if (type === 'MRS' && dailyMrs[ds2] !== undefined) dailyMrs[ds2]++;
        }
      }
      if (type === 'MRIF' && r.item_summary) {
        String(r.item_summary).split(',').forEach(function(chunk) {
          var m = chunk.trim().match(/^(.+?)\s+x\s*(\d+)/i);
          if (m) {
            var code = m[1].trim();
            var qty = parseInt(m[2], 10) || 0;
            if (!itemCounts[code]) itemCounts[code] = { count: 0, totalQty: 0 };
            itemCounts[code].count++;
            itemCounts[code].totalQty += qty;
          }
        });
      }
      if (r.processed_by) {
        var staff = String(r.processed_by).trim();
        if (staff) staffCounts[staff] = (staffCounts[staff] || 0) + 1;
      }
      if (type === 'MRIF' && r.requestor) {
        var req = String(r.requestor).trim();
        if (req && req.toUpperCase() !== 'WAREHOUSE') {
          requestorCounts[req] = (requestorCounts[req] || 0) + 1;
        }
      }
      if (status === 'COMPLETED' && r.created_at && r.processed_at) {
        var created = new Date(r.created_at);
        var processed = new Date(r.processed_at);
        if (!isNaN(created.getTime()) && !isNaN(processed.getTime()) && processed >= created) {
          var diffHours = (processed - created) / 3600000;
          if (diffHours >= 0) processingTimesHours.push(diffHours);
        }
      }
    });

    var sortedDates = Object.keys(dailyMrif).sort();
    var dailyRequests = sortedDates.map(function(date) {
      return {
        date: date,
        mrif: dailyMrif[date] || 0, mrr: dailyMrr[date] || 0, mrs: dailyMrs[date] || 0,
        count: (dailyMrif[date] || 0) + (dailyMrr[date] || 0) + (dailyMrs[date] || 0)
      };
    });

    var sortedItems = Object.keys(itemCounts).sort(function(a, b) {
      return itemCounts[b].count - itemCounts[a].count;
    });
    var topItems = sortedItems.map(function(code) {
      return { itemCode: code, count: itemCounts[code].count, totalQty: itemCounts[code].totalQty };
    });

    var sortedStaff = Object.keys(staffCounts).sort(function(a, b) {
      return staffCounts[b] - staffCounts[a];
    });
    var staffPerformance = sortedStaff.map(function(name) {
      return { name: name, count: staffCounts[name] };
    });

    var sortedRequestors = Object.keys(requestorCounts).sort(function(a, b) {
      return requestorCounts[b] - requestorCounts[a];
    });
    var requestorPerformance = sortedRequestors.map(function(name) {
      return { name: name, count: requestorCounts[name] };
    });

    var avgHours = 0;
    if (processingTimesHours.length > 0) {
      avgHours = processingTimesHours.reduce(function(a, b) { return a + b; }, 0) / processingTimesHours.length;
    }

    return {
      success: true,
      dailyRequests: dailyRequests,
      topItems: topItems,
      staffPerformance: staffPerformance,
      requestorPerformance: requestorPerformance,
      avgProcessingTime: avgHours / 24,
      avgProcessingTimeHours: avgHours,
      totals: {
        total: total, pending: pending, completed: completed, partial: partial,
        mrif: mrifCount, mrr: mrrCount, mrs: mrsCount
      }
    };
  } catch (err) {
    console.error('[sbGetDashboardAnalytics]', err);
    return { success: false, error: err.message };
  }
}

console.log('✅ supabase-api-docs.js loaded (v6)');
