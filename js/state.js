// ============================================================
// GLOBAL STATE & MODAL REFERENCES
// ============================================================

const state = {
  currentModule: 'MRIF',
  currentDoc: null,
  items: [],
  html5QrCode: null,
  quickScanner: null,
  currentCamera: 'environment',
  torchOn: false,
  cameras: [],
  requestInventoryList: [],
  requestorList: [],
  poItemsData: [],
  currentPoNo: '',
  currentPoPrf: '',
  currentPoClient: '',
  currentPoSupplier: '',
  poScanModal: null,
  poItemsModal: null,
  errorTimer: null,
  docList: [],
  pinBuffer: '',
  pinAttempts: 0,
  isLoading: false,
  warehouseName: localStorage.getItem('ivm_warehouseName') || ''
};

let lastQrDocNo = '';
let lastQrTicketNo = '';
let lastQrImageData = '';

// ─── Modal references (initialized in main.js) ───
var qtyModal, successModal, settingsModal, newRequestModal, requestSuccessModal;
var whNotifModal, mrifListModal, mrifPrintModal, pendingMrifModal;
var mrrListModal, mrrPrintModal, mrsListModal, mrsPrintModal;
var quickScanModal, roleModal, productionNameModal, batchVerifyModal, qrZoomModal;

// ─── Manual MRIF Modal ───
var manualMrifModal = null;
var manualMrifItems = [];
