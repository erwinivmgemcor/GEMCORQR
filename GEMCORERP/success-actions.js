// ============================================================
// GEMCOR ERP — Success modal actions (MRIF / MRR / MRS create pages)
//   erpSuccessDownloadQr()  → save the QR as PNG (DOCNO-QR.png)
//   erpSuccessPrint(type)   → open the print preview of the document just created
// ============================================================
(function () {
  var st = document.createElement('style');
  st.textContent =
    '#erpPrintModal{z-index:1075 !important;}' +
    'body > .modal-backdrop ~ .modal-backdrop{z-index:1070 !important;}';
  document.head.appendChild(st);

  function docNo() { var el = document.getElementById('successDocNo'); return el ? el.textContent.trim() : ''; }
  function toast(msg) {
    if (typeof erpPrintShowToast === 'function') return erpPrintShowToast(msg);
    if (typeof erpShowToast === 'function') return erpShowToast(msg);
    alert(msg);
  }

  window.erpSuccessDownloadQr = async function () {
    var img = document.getElementById('successQrImg'), no = docNo();
    if (!img || !img.src || !no) return;
    try {
      // bigger copy for sharp printing
      var url = img.src.replace(/size=\d+x\d+/, 'size=600x600');
      var res = await fetch(url);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var blob = await res.blob();
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = no.replace(/[^\w.\-]+/g, '_') + '-QR.png';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
    } catch (e) {
      console.warn('[QR download] fallback', e);
      window.open(img.src.replace(/size=\d+x\d+/, 'size=600x600'), '_blank');   // right-click → Save image
    }
  };

  window.erpSuccessPrint = function (type) {
    var no = docNo();
    if (!no) return;
    if (typeof erpOpenPrintPreview === 'function') return erpOpenPrintPreview(no, type);
    toast('Print module not loaded. Refresh the page.');
  };
})();
