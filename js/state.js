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
  warehouseName: localStorage.getItem('ivm_warehouseName') || '',
  currentUser: localStorage.getItem('ivm_username') || null,
  currentUserFullname: localStorage.getItem('ivm_userFullname') || ''
};

let lastQrDocNo = '';
let lastQrTicketNo = '';
let lastQrImageData = '';

// ─── Modal references ───
var qtyModal, successModal, settingsModal, newRequestModal, requestSuccessModal;
var whNotifModal, mrifListModal, mrifPrintModal, pendingMrifModal;
var mrrListModal, mrrPrintModal, mrsListModal, mrsPrintModal;
var quickScanModal, roleModal, productionNameModal, batchVerifyModal, qrZoomModal;

var manualMrifModal = null;
var manualMrifItems = [];
