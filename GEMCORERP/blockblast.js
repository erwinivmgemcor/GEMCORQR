// ============================================================
// GEMCOR ERP — Break Room · Crate Blast (v1.0)
//  - Engine: 8x8 board, 3-piece tray, line clears, combo
//  - Offline-first: naka-save ang laro sa device, naka-queue ang scores
//  - Sync: erp_game_scores (Supabase), idempotent via client_id
//  - Leaderboard: Ngayon / Linggong ito (Mon–Sun, Manila) / Lahat
// Gumagana sa block-blast.html at sa offline.html (BlockBlast.mount)
// ============================================================
(function (global) {
  'use strict';

  var GAME_ID = 'crate_blast';
  var SIZE = 8;
  var GAP = 3;
  var PH_OFFSET = 8 * 3600 * 1000;         // Manila = UTC+8, walang DST
  var DAY = 86400000;
  var LS = {
    state: 'bb_state_v1',
    best: 'bb_best_v1',
    pending: 'bb_pending_v1',
    lb: 'bb_lb_v1_',
    sound: 'bb_sound_v1'
  };

  // ═══════════════════════════════════════════════════════════
  // ENGINE (pure — walang DOM, kaya natetest sa Node)
  // ═══════════════════════════════════════════════════════════
  var BASE = [
    { key: 'dot', rows: ['#'],                      w: 1.5 },
    { key: 'i2',  rows: ['##'],                     w: 4,   rot: true },
    { key: 'i3',  rows: ['###'],                    w: 5,   rot: true },
    { key: 'i4',  rows: ['####'],                   w: 3,   rot: true },
    { key: 'i5',  rows: ['#####'],                  w: 1.6, rot: true },
    { key: 'o2',  rows: ['##', '##'],               w: 5 },
    { key: 'o3',  rows: ['###', '###', '###'],      w: 1.2 },
    { key: 'r23', rows: ['###', '###'],             w: 2.6, rot: true },
    { key: 'c3',  rows: ['#.', '##'],               w: 5,   rot: true },
    { key: 'l4',  rows: ['#.', '#.', '##'],         w: 4,   rot: true, mirror: true },
    { key: 'l5',  rows: ['#..', '#..', '###'],      w: 2.4, rot: true },
    { key: 't4',  rows: ['###', '.#.'],             w: 3,   rot: true },
    { key: 's4',  rows: ['.##', '##.'],             w: 2.6, rot: true, mirror: true }
  ];

  function rotateRows(rows) {
    var h = rows.length, w = rows[0].length, out = [];
    for (var c = 0; c < w; c++) {
      var line = '';
      for (var r = h - 1; r >= 0; r--) line += rows[r][c];
      out.push(line);
    }
    return out;
  }
  function mirrorRows(rows) {
    return rows.map(function (s) { return s.split('').reverse().join(''); });
  }

  var SHAPES = [];
  var BY_KEY = {};
  (function build() {
    BASE.forEach(function (b, bi) {
      var variants = [], seen = {};
      function add(rows) {
        var k = rows.join('|');
        if (seen[k]) return;
        seen[k] = 1;
        variants.push(rows);
      }
      var starts = [b.rows];
      if (b.mirror) starts.push(mirrorRows(b.rows));
      starts.forEach(function (s) {
        var cur = s;
        add(cur);
        if (b.rot) for (var i = 0; i < 3; i++) { cur = rotateRows(cur); add(cur); }
      });
      variants.forEach(function (rows, vi) {
        var cells = [];
        for (var r = 0; r < rows.length; r++)
          for (var c = 0; c < rows[r].length; c++)
            if (rows[r][c] === '#') cells.push([r, c]);
        var shape = {
          key: b.key + '_' + vi,
          base: b.key,
          rows: rows,
          h: rows.length,
          w: rows[0].length,
          cells: cells,
          color: (bi % 6) + 1,
          weight: b.w / variants.length
        };
        SHAPES.push(shape);
        BY_KEY[shape.key] = shape;
      });
    });
  })();

  function createBoard() {
    var b = [];
    for (var r = 0; r < SIZE; r++) { b.push([]); for (var c = 0; c < SIZE; c++) b[r].push(0); }
    return b;
  }
  function copyBoard(b) { return b.map(function (row) { return row.slice(); }); }

  function fits(board, shape, r, c) {
    if (r < 0 || c < 0 || r + shape.h > SIZE || c + shape.w > SIZE) return false;
    for (var i = 0; i < shape.cells.length; i++) {
      if (board[r + shape.cells[i][0]][c + shape.cells[i][1]]) return false;
    }
    return true;
  }
  function anyFit(board, shape) {
    for (var r = 0; r <= SIZE - shape.h; r++)
      for (var c = 0; c <= SIZE - shape.w; c++)
        if (fits(board, shape, r, c)) return true;
    return false;
  }
  function fullLines(board) {
    var rows = [], cols = [], r, c;
    for (r = 0; r < SIZE; r++) {
      var f = true;
      for (c = 0; c < SIZE; c++) if (!board[r][c]) { f = false; break; }
      if (f) rows.push(r);
    }
    for (c = 0; c < SIZE; c++) {
      var g = true;
      for (r = 0; r < SIZE; r++) if (!board[r][c]) { g = false; break; }
      if (g) cols.push(c);
    }
    return { rows: rows, cols: cols };
  }
  // Ilagay ang piece (mutates). Ibabalik ang mga full line (hindi pa buburahin).
  function place(board, shape, r, c) {
    for (var i = 0; i < shape.cells.length; i++) {
      board[r + shape.cells[i][0]][c + shape.cells[i][1]] = shape.color;
    }
    var f = fullLines(board);
    return { rows: f.rows, cols: f.cols, lines: f.rows.length + f.cols.length };
  }
  function clearLines(board, rows, cols) {
    rows.forEach(function (r) { for (var c = 0; c < SIZE; c++) board[r][c] = 0; });
    cols.forEach(function (c) { for (var r = 0; r < SIZE; r++) board[r][c] = 0; });
  }
  function isEmpty(board) {
    for (var r = 0; r < SIZE; r++) for (var c = 0; c < SIZE; c++) if (board[r][c]) return false;
    return true;
  }
  function fillRatio(board) {
    var n = 0;
    for (var r = 0; r < SIZE; r++) for (var c = 0; c < SIZE; c++) if (board[r][c]) n++;
    return n / (SIZE * SIZE);
  }
  // Preview lang: anong mga line ang mabubura kung ilalagay dito (walang mutation)
  function previewClears(board, shape, r, c) {
    var tmp = copyBoard(board);
    for (var i = 0; i < shape.cells.length; i++) tmp[r + shape.cells[i][0]][c + shape.cells[i][1]] = 9;
    return fullLines(tmp);
  }

  function pickShape(rng, favorSmall) {
    var total = 0, i, w, ws = [];
    for (i = 0; i < SHAPES.length; i++) {
      w = SHAPES[i].weight;
      if (favorSmall && SHAPES[i].cells.length <= 4) w *= 1.7;
      ws.push(w); total += w;
    }
    var t = rng() * total;
    for (i = 0; i < SHAPES.length; i++) { t -= ws[i]; if (t <= 0) return SHAPES[i]; }
    return SHAPES[SHAPES.length - 1];
  }
  // 3 piece. Sinisigurong may kahit isang kasya (hindi unfair na game over).
  // Kapag puno na ang board (>50%), mas madalas ang maliliit na piece.
  function dealTray(board, rng) {
    rng = rng || Math.random;
    var favor = fillRatio(board) > 0.5, tray = null;
    for (var attempt = 0; attempt < 60; attempt++) {
      tray = [pickShape(rng, favor), pickShape(rng, favor), pickShape(rng, favor)];
      if (tray.some(function (s) { return anyFit(board, s); })) return tray;
    }
    // Halos puno ang board at walang lumabas na kasya: pilitin ang isang piece na kasya (kung meron).
    var fitting = SHAPES.filter(function (s) { return anyFit(board, s); });
    if (fitting.length) {
      var pick = fitting[Math.floor(rng() * fitting.length)];
      tray[Math.floor(rng() * 3)] = pick;
    }
    return tray;
  }

  // Score: 1/cell + 10·n² bawat clear × combo, + 150 perfect clear
  // combo ×1.0, 1.5, 2.0 … max ×3.0
  function comboMult(combo) { return Math.min(1 + 0.5 * (combo - 1), 3); }
  function moveScore(cellsPlaced, lines, combo, perfect) {
    var gain = cellsPlaced;
    if (lines > 0) gain += Math.round(10 * lines * lines * comboMult(combo));
    if (perfect) gain += 150;
    return gain;
  }

  var Engine = {
    SIZE: SIZE, SHAPES: SHAPES, byKey: BY_KEY,
    createBoard: createBoard, copyBoard: copyBoard,
    fits: fits, anyFit: anyFit, fullLines: fullLines,
    place: place, clearLines: clearLines, isEmpty: isEmpty,
    previewClears: previewClears, dealTray: dealTray,
    comboMult: comboMult, moveScore: moveScore
  };

  // ═══════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════
  function lsGet(k, fb) {
    try { var v = localStorage.getItem(k); return v == null ? fb : JSON.parse(v); } catch (e) { return fb; }
  }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }
  function uid() {
    try { if (global.crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (e) {}
    return 'bb-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }
  function fmt(n) { return Number(n || 0).toLocaleString('en-US'); }
  function me() {
    var u = '', f = '', d = '';
    try {
      u = localStorage.getItem('ivm_username') || '';
      f = localStorage.getItem('ivm_userFullname') || '';
      d = localStorage.getItem('ivm_userDepartment') || '';
    } catch (e) {}
    return { username: u, fullname: f || u, department: d };
  }
  function netState() {
    if (global.erpNet && global.erpNet.state) return global.erpNet.state;
    return (typeof navigator !== 'undefined' && navigator.onLine === false) ? 'offline' : 'online';
  }
  function hasApi() { return typeof global.erpUrl === 'function' && typeof global.erpHeaders === 'function'; }

  function fetchTimeout(url, opts, ms) {
    var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, ms) : null;
    opts = opts || {};
    opts.cache = 'no-store';
    if (ctrl) opts.signal = ctrl.signal;
    return fetch(url, opts).then(function (res) { if (timer) clearTimeout(timer); return res; },
      function (err) { if (timer) clearTimeout(timer); throw err; });
  }

  // ═══════════════════════════════════════════════════════════
  // SYNC — queue ng scores (offline-safe, hindi nadodoble)
  // ═══════════════════════════════════════════════════════════
  var Sync = {
    busy: false,
    lastError: '',
    queue: function () { return lsGet(LS.pending, []); },
    enqueue: function (row) {
      var q = Sync.queue();
      q.push(row);
      if (q.length > 100) q = q.slice(q.length - 100);
      lsSet(LS.pending, q);
    },
    has: function (clientId) {
      return Sync.queue().some(function (r) { return r.client_id === clientId; });
    },
    _post: function (rows) {
      return fetchTimeout(global.erpUrl('erp_game_scores') + '?on_conflict=client_id', {
        method: 'POST',
        headers: global.erpHeaders({ 'Prefer': 'resolution=ignore-duplicates,return=minimal' }),
        body: JSON.stringify(rows)
      }, 10000);
    },
    // Ibabalik ang bilang ng natira sa queue.
    flush: function () {
      if (Sync.busy) return Promise.resolve(Sync.queue().length);
      var q = Sync.queue();
      if (!q.length) return Promise.resolve(0);
      if (!hasApi() || netState() === 'offline') return Promise.resolve(q.length);
      Sync.busy = true;
      var sent = {};

      function done() {
        Sync.busy = false;
        var left = Sync.queue().filter(function (r) { return !sent[r.client_id]; });
        if (left.length) lsSet(LS.pending, left); else lsDel(LS.pending);
        if (Object.keys(sent).length) {
          try { global.dispatchEvent(new CustomEvent('bb:synced')); } catch (e) {}
        }
        return left.length;
      }

      return Sync._post(q).then(function (res) {
        if (res.ok) { q.forEach(function (r) { sent[r.client_id] = 1; }); Sync.lastError = ''; return done(); }
        if (res.status === 400) {
          // May isang masamang row — isa-isahin para hindi ma-block ang iba.
          return q.reduce(function (p, row) {
            return p.then(function () {
              return Sync._post([row]).then(function (r1) {
                if (r1.ok || r1.status === 400 || r1.status === 409 || r1.status === 422) sent[row.client_id] = 1;
              });
            });
          }, Promise.resolve()).then(done);
        }
        Sync.lastError = 'HTTP ' + res.status;
        return done();
      }).catch(function (err) {
        Sync.lastError = (err && err.message) || 'network';
        return done();
      });
    }
  };

  // ═══════════════════════════════════════════════════════════
  // LEADERBOARD
  // ═══════════════════════════════════════════════════════════
  function rangeStart(period) {
    if (period === 'all') return null;
    var days = Math.floor((Date.now() + PH_OFFSET) / DAY);
    var startDay = days;
    if (period === 'week') {
      var weekday = (days + 4) % 7;              // 0 = Linggo (1970-01-01 ay Huwebes)
      startDay = days - ((weekday + 6) % 7);     // Lunes
    }
    return new Date(startDay * DAY - PH_OFFSET).toISOString();
  }

  function aggregate(rows) {
    var by = {};
    rows.forEach(function (r) {
      var k = r.username;
      var cur = by[k];
      if (!cur) {
        by[k] = { username: k, fullname: r.fullname || k, department: r.department || '',
          score: r.score, lines: r.lines_cleared || 0, combo: r.best_combo || 0,
          games: 1, at: r.played_at, pending: !!r.pending };
      } else {
        cur.games++;
        if (r.score > cur.score || (r.score === cur.score && r.played_at < cur.at)) {
          cur.score = r.score; cur.lines = r.lines_cleared || 0; cur.at = r.played_at;
          cur.fullname = r.fullname || cur.fullname; cur.department = r.department || cur.department;
        }
        if ((r.best_combo || 0) > cur.combo) cur.combo = r.best_combo;
        if (r.pending) cur.pending = true;
      }
    });
    return Object.keys(by).map(function (k) { return by[k]; }).sort(function (a, b) {
      return b.score - a.score || (a.at < b.at ? -1 : 1);
    });
  }

  function loadBoard(period) {
    var start = rangeStart(period);
    var pending = Sync.queue().filter(function (r) { return !start || r.played_at >= start; })
      .map(function (r) { var c = {}; for (var k in r) c[k] = r[k]; c.pending = true; return c; });

    function withPending(rows) {
      var seen = {};
      rows.forEach(function (r) { if (r.client_id) seen[r.client_id] = 1; });
      return rows.concat(pending.filter(function (p) { return !seen[p.client_id]; }));
    }

    if (!hasApi() || netState() === 'offline') {
      var cached = lsGet(LS.lb + period, null);
      return Promise.resolve({ rows: aggregate(withPending(cached ? cached.rows : [])), stale: true, at: cached ? cached.at : null, failed: false });
    }
    var q = 'select=client_id,username,fullname,department,score,lines_cleared,best_combo,played_at' +
      '&game=eq.' + GAME_ID + (start ? '&played_at=gte.' + encodeURIComponent(start) : '') +
      '&order=score.desc&limit=500';
    return fetchTimeout(global.erpUrl('erp_game_scores') + '?' + q, { headers: global.erpHeaders() }, 9000)
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (rows) {
        lsSet(LS.lb + period, { at: Date.now(), rows: rows });
        return { rows: aggregate(withPending(rows)), stale: false, at: Date.now(), failed: false };
      })
      .catch(function (err) {
        var cached = lsGet(LS.lb + period, null);
        return { rows: aggregate(withPending(cached ? cached.rows : [])), stale: true, at: cached ? cached.at : null, failed: true, error: (err && err.message) || '' };
      });
  }

  // ═══════════════════════════════════════════════════════════
  // SOUND (default OFF — opisina ito)
  // ═══════════════════════════════════════════════════════════
  var Sound = {
    on: false, ctx: null,
    init: function () { Sound.on = !!lsGet(LS.sound, false); },
    set: function (v) { Sound.on = v; lsSet(LS.sound, v); },
    _ctx: function () {
      if (!Sound.ctx) {
        var AC = global.AudioContext || global.webkitAudioContext;
        if (AC) { try { Sound.ctx = new AC(); } catch (e) {} }
      }
      if (Sound.ctx && Sound.ctx.state === 'suspended') Sound.ctx.resume();
      return Sound.ctx;
    },
    beep: function (freq, dur, type, vol, delay) {
      if (!Sound.on) return;
      var ctx = Sound._ctx(); if (!ctx) return;
      var t = ctx.currentTime + (delay || 0);
      var o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type || 'square'; o.frequency.value = freq;
      g.gain.setValueAtTime(vol || 0.05, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(ctx.destination);
      o.start(t); o.stop(t + dur + 0.02);
    },
    place: function () { Sound.beep(196, 0.07, 'square', 0.04); },
    clear: function (n) { for (var i = 0; i < Math.min(n + 2, 6); i++) Sound.beep(392 * Math.pow(1.122, i * 2), 0.11, 'triangle', 0.07, i * 0.06); },
    over: function () { [330, 262, 196, 147].forEach(function (f, i) { Sound.beep(f, 0.22, 'sawtooth', 0.05, i * 0.16); }); }
  };

  // ═══════════════════════════════════════════════════════════
  // UI
  // ═══════════════════════════════════════════════════════════
  var ICON = {
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/></svg>',
    on: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>',
    off: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H2v6h4l5 4z"/><path d="M22 9l-6 6"/><path d="M16 9l6 6"/></svg>',
    again: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 3v6h6"/></svg>'
  };
  var NET_TEXT = { online: 'Online', slow: 'Mabagal ang net', offline: 'Offline', unknown: 'Checking…' };
  var PERIODS = [['today', 'Ngayon'], ['week', 'Linggong ito'], ['all', 'Lahat']];

  function mount(host, opts) {
    opts = opts || {};
    var offlineMode = opts.mode === 'offline';
    var user = me();
    Sound.init();

    host.innerHTML =
      '<div class="bb-root">' +
      '<div class="bb-wrap" data-tab="play">' +
        (offlineMode ? '' :
        '<header class="bb-top">' +
          '<a class="bb-back" href="' + esc(opts.backHref || 'index.html') + '">' + ICON.back + '<span>' + esc(opts.backLabel || 'ERP') + '</span></a>' +
          '<div class="bb-title"><b>Crate Blast</b><span>Break Room</span></div>' +
          '<div class="bb-net" data-state="online" id="bbNet"><i></i><span>Online</span></div>' +
        '</header>') +
        '<div class="bb-tabs" role="tablist">' +
          '<button class="bb-tab" role="tab" data-tab="play" aria-selected="true">Laro</button>' +
          '<button class="bb-tab" role="tab" data-tab="rank" aria-selected="false">Ranking</button>' +
        '</div>' +
        '<div class="bb-cols">' +
          '<section class="bb-play" aria-label="Laro">' +
            '<div class="bb-hud">' +
              '<div class="bb-stat"><small>Score</small><strong id="bbScore">0</strong></div>' +
              '<div class="bb-combo" id="bbCombo" hidden>×2</div>' +
              '<div class="bb-stat bb-best"><small>Best mo</small><strong id="bbBest">0</strong></div>' +
            '</div>' +
            '<div class="bb-stage">' +
              '<div class="bb-board" id="bbBoard" aria-label="Board"></div>' +
              '<div class="bb-callout" id="bbCallout"><span class="big"></span><span class="sub"></span></div>' +
              '<div class="bb-over" id="bbOver"><div class="bb-over-card">' +
                '<h2>Game over</h2>' +
                '<div class="final" id="bbFinal">0</div>' +
                '<div class="newbest" id="bbNewBest" hidden>Bagong best!</div>' +
                '<div class="facts" id="bbFacts"></div>' +
                '<p class="sync" id="bbSync"></p>' +
                '<div class="row">' +
                  '<button class="bb-btn primary" id="bbAgain" type="button">' + ICON.again + 'Laro ulit</button>' +
                  '<button class="bb-btn" id="bbSeeRank" type="button">Tingnan ang ranking</button>' +
                '</div>' +
              '</div></div>' +
            '</div>' +
            '<div class="bb-tray" id="bbTray"></div>' +
            '<div class="bb-bar">' +
              '<button class="bb-btn grow" id="bbNew" type="button">' + ICON.again + 'Bagong laro</button>' +
              '<button class="bb-btn" id="bbSound" type="button" aria-label="Tunog"></button>' +
            '</div>' +
            '<p class="bb-hint">I-drag ang piece papunta sa board. Mabubura ang buong row o column na puno. ' +
              'Magkakasunod na clear = combo. Naka-save ang laro mo kahit mawalan ng internet.</p>' +
          '</section>' +
          '<section class="bb-rank" aria-label="Ranking">' +
            '<div class="bb-rank-head"><h2>Ranking</h2>' +
              '<div class="bb-seg" id="bbSeg"></div></div>' +
            '<div class="bb-note" id="bbNote"></div>' +
            '<ol class="bb-list" id="bbList"></ol>' +
          '</section>' +
        '</div>' +
      '</div></div>';

    var root = host.querySelector('.bb-root');
    var wrap = host.querySelector('.bb-wrap');
    var $ = function (id) { return host.querySelector('#' + id); };
    var boardEl = $('bbBoard'), trayEl = $('bbTray'), scoreEl = $('bbScore'), bestEl = $('bbBest');
    var comboEl = $('bbCombo'), calloutEl = $('bbCallout'), overEl = $('bbOver');
    var slots = [];
    var i;
    for (i = 0; i < SIZE * SIZE; i++) {
      var s = document.createElement('div');
      s.className = 'bb-slot';
      boardEl.appendChild(s);
      slots.push(s);
    }

    var state = null, locked = false, drag = null, M = { step: 44, ox: 0, oy: 0 };
    var ghostIdx = [], clearIdx = [];

    // ── best ──
    function bestKey() { return user.username || 'guest'; }
    function getBest() { return (lsGet(LS.best, {}))[bestKey()] || 0; }
    function setBest(v) { var b = lsGet(LS.best, {}); b[bestKey()] = v; lsSet(LS.best, b); }

    // ── state ──
    function newState() {
      var board = createBoard();
      return {
        v: 1, id: uid(), board: board,
        tray: dealTray(board).map(function (s) { return s.key; }),
        score: 0, lines: 0, combo: 0, missed: 0, bestCombo: 0, moves: 0,
        playMs: 0, startedAt: Date.now(), lastAt: Date.now(), over: false
      };
    }
    function validState(st) {
      if (!st || st.v !== 1 || st.over) return false;
      if (!Array.isArray(st.board) || st.board.length !== SIZE) return false;
      for (var r = 0; r < SIZE; r++) if (!Array.isArray(st.board[r]) || st.board[r].length !== SIZE) return false;
      if (!Array.isArray(st.tray) || st.tray.length !== 3) return false;
      return st.tray.every(function (k) { return k === null || !!BY_KEY[k]; });
    }
    function persist() { lsSet(LS.state, state); }

    // ── measure ──
    function measure() {
      var a = slots[0].getBoundingClientRect(), b = slots[1].getBoundingClientRect();
      if (!a.width) return;
      M.step = b.left - a.left; M.ox = a.left; M.oy = a.top;
      root.style.setProperty('--bb-step', M.step + 'px');
    }

    // ── render ──
    function renderBoard(b) {
      for (var r = 0; r < SIZE; r++) for (var c = 0; c < SIZE; c++) {
        var v = b[r][c];
        slots[r * SIZE + c].className = 'bb-slot' + (v ? ' filled c' + v : '');
      }
      ghostIdx = []; clearIdx = [];
    }
    function renderHud() {
      scoreEl.textContent = fmt(state.score);
      var best = Math.max(getBest(), state.score);
      bestEl.textContent = fmt(best);
      if (state.combo >= 2) {
        var changed = comboEl.textContent !== '×' + state.combo;
        comboEl.hidden = false;
        comboEl.textContent = '×' + state.combo;
        if (changed) { comboEl.classList.remove('bump'); void comboEl.offsetWidth; comboEl.classList.add('bump'); }
      } else comboEl.hidden = true;
    }
    function pieceHTML(shape) {
      var h = '<div class="bb-piece c' + shape.color + '" style="grid-template-columns:repeat(' + shape.w + ',auto)">';
      for (var r = 0; r < shape.h; r++) for (var c = 0; c < shape.w; c++) {
        h += '<div class="bb-pc ' + (shape.rows[r][c] === '#' ? '' : 'off') + '"></div>';
      }
      return h + '</div>';
    }
    function renderTray(entering) {
      trayEl.innerHTML = '';
      state.tray.forEach(function (k, idx) {
        var slot = document.createElement('div');
        slot.className = 'bb-tray-slot' + (k ? '' : ' empty') + (k && entering ? ' enter' : '');
        slot.setAttribute('data-idx', idx);
        if (k) {
          var shape = BY_KEY[k];
          slot.innerHTML = pieceHTML(shape);
          if (!anyFit(state.board, shape)) slot.classList.add('stuck');
          slot.addEventListener('pointerdown', function (e) { startDrag(e, idx, slot); });
        }
        trayEl.appendChild(slot);
      });
    }
    function renderAll(entering) { renderBoard(state.board); renderHud(); renderTray(entering); }

    // ── drag ──
    function clearPreview() {
      ghostIdx.forEach(function (n) { slots[n].classList.remove('ghost'); slots[n].classList.remove('c1', 'c2', 'c3', 'c4', 'c5', 'c6'); });
      clearIdx.forEach(function (n) { slots[n].classList.remove('will-clear'); });
      ghostIdx = []; clearIdx = [];
    }
    function showPreview(shape, r, c) {
      clearPreview();
      shape.cells.forEach(function (cell) {
        var n = (r + cell[0]) * SIZE + (c + cell[1]);
        slots[n].classList.add('ghost', 'c' + shape.color);
        ghostIdx.push(n);
      });
      var f = previewClears(state.board, shape, r, c);
      f.rows.forEach(function (rr) { for (var cc = 0; cc < SIZE; cc++) { var n = rr * SIZE + cc; slots[n].classList.add('will-clear'); clearIdx.push(n); } });
      f.cols.forEach(function (cc) { for (var rr = 0; rr < SIZE; rr++) { var n = rr * SIZE + cc; slots[n].classList.add('will-clear'); clearIdx.push(n); } });
    }
    function startDrag(e, idx, slotEl) {
      if (locked || state.over || drag || !state.tray[idx]) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      measure();
      var shape = BY_KEY[state.tray[idx]];
      var el = document.createElement('div');
      el.className = 'bb-drag c' + shape.color;
      el.style.gridTemplateColumns = 'repeat(' + shape.w + ', auto)';
      var h = '';
      for (var r = 0; r < shape.h; r++) for (var c = 0; c < shape.w; c++) h += '<div class="bb-pc ' + (shape.rows[r][c] === '#' ? '' : 'off') + '"></div>';
      el.innerHTML = h;
      root.appendChild(el);
      slotEl.classList.add('dragging');
      drag = { idx: idx, shape: shape, pid: e.pointerId, type: e.pointerType, el: el, slot: slotEl, r: null, c: null };
      if (Sound.on) Sound._ctx();
      moveDrag(e);
      window.addEventListener('pointermove', onMove, { passive: false });
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onCancel);
    }
    function moveDrag(e) {
      var sh = drag.shape;
      var w = sh.w * M.step - GAP, h = sh.h * M.step - GAP;
      var lift = drag.type === 'mouse' ? 0 : (h / 2 + 58);   // sa touch, nasa itaas ng daliri
      var left = e.clientX - w / 2, top = e.clientY - lift - h / 2;
      drag.el.style.transform = 'translate(' + left + 'px,' + top + 'px)';
      measure();
      var c = Math.round((left - M.ox) / M.step), r = Math.round((top - M.oy) / M.step);
      if (r === drag.r && c === drag.c) return;
      drag.r = r; drag.c = c;
      if (fits(state.board, sh, r, c)) showPreview(sh, r, c);
      else { clearPreview(); drag.ok = false; return; }
      drag.ok = true;
    }
    function onMove(e) {
      if (!drag || e.pointerId !== drag.pid) return;
      e.preventDefault();
      moveDrag(e);
    }
    function endDrag() {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      if (drag) { drag.el.remove(); drag.slot.classList.remove('dragging'); }
      clearPreview();
      drag = null;
    }
    function onUp(e) {
      if (!drag || e.pointerId !== drag.pid) return;
      var d = drag, ok = d.r !== null && fits(state.board, d.shape, d.r, d.c);
      endDrag();
      if (ok) commit(d.idx, d.r, d.c);
    }
    function onCancel(e) { if (drag && e.pointerId === drag.pid) endDrag(); }

    // ── gameplay ──
    var CALL = ['Clear', 'Double', 'Triple', 'Quad', 'Mega'];
    function callout(big, sub) {
      calloutEl.querySelector('.big').textContent = big;
      calloutEl.querySelector('.sub').textContent = sub || '';
      calloutEl.classList.remove('show'); void calloutEl.offsetWidth; calloutEl.classList.add('show');
    }

    function commit(idx, r, c) {
      var shape = BY_KEY[state.tray[idx]];
      var res = place(state.board, shape, r, c);
      var shown = copyBoard(state.board);          // may piece, hindi pa clear
      var placedIdx = shape.cells.map(function (cell) { return (r + cell[0]) * SIZE + (c + cell[1]); });
      var perfect = false;

      if (res.lines > 0) {
        clearLines(state.board, res.rows, res.cols);
        perfect = isEmpty(state.board);
        state.combo += 1; state.missed = 0;
        if (state.combo > state.bestCombo) state.bestCombo = state.combo;
        state.lines += res.lines;
      } else {
        state.missed += 1;
        if (state.missed >= 3) { state.combo = 0; state.missed = 0; }   // 3 galaw na walang clear
      }
      var gain = moveScore(shape.cells.length, res.lines, Math.max(state.combo, 1), perfect);
      state.score += gain;

      var now = Date.now();
      state.playMs += Math.min(now - state.lastAt, 60000);
      state.lastAt = now;
      state.moves += 1;
      state.tray[idx] = null;

      var dealt = false;
      if (state.tray.every(function (k) { return k === null; })) {
        state.tray = dealTray(state.board).map(function (s) { return s.key; });
        dealt = true;
      }
      var over = !state.tray.some(function (k) { return k && anyFit(state.board, BY_KEY[k]); });
      persist();

      // visuals
      locked = true;
      renderBoard(shown);
      placedIdx.forEach(function (n) { slots[n].classList.add('pop'); });
      renderHud();
      renderTray(dealt);
      Sound.place();
      var wait = 60;
      if (res.lines > 0) {
        var gone = {};
        res.rows.forEach(function (rr) { for (var cc = 0; cc < SIZE; cc++) gone[rr * SIZE + cc] = 1; });
        res.cols.forEach(function (cc) { for (var rr = 0; rr < SIZE; rr++) gone[rr * SIZE + cc] = 1; });
        Object.keys(gone).forEach(function (n) { slots[n].classList.remove('pop'); slots[n].classList.add('clearing'); });
        Sound.clear(res.lines);
        try { if (navigator.vibrate) navigator.vibrate(14); } catch (e) {}
        callout(perfect ? 'Perfect!' : CALL[Math.min(res.lines, 5) - 1],
          '+' + fmt(gain) + (state.combo >= 2 ? '  ·  Combo ×' + state.combo : ''));
        wait = 360;
      }
      setTimeout(function () {
        renderBoard(state.board);
        locked = false;
        if (over) setTimeout(function () { finish(true); }, 200);
      }, wait);
    }

    // ── tapos ng laro ──
    function buildRow() {
      return {
        client_id: state.id, game: GAME_ID,
        username: user.username, fullname: user.fullname, department: user.department || null,
        score: state.score, lines_cleared: state.lines, best_combo: state.bestCombo,
        moves: state.moves, duration_sec: Math.round(state.playMs / 1000),
        played_at: new Date().toISOString()
      };
    }
    function finish(showOver) {
      if (state.over) return;
      state.over = true;
      lsDel(LS.state);
      var prevBest = getBest();
      var isBest = state.score > prevBest && state.score > 0;
      if (isBest) setBest(state.score);
      var counted = state.score > 0 && state.moves >= 3 && !!user.username;
      if (counted) Sync.enqueue(buildRow());

      if (showOver) {
        Sound.over();
        $('bbFinal').textContent = fmt(state.score);
        $('bbNewBest').hidden = !isBest;
        $('bbFacts').textContent = state.lines + ' lines · best combo ×' + Math.max(state.bestCombo, 0) + ' · ' + state.moves + ' galaw';
        var syncEl = $('bbSync');
        if (!user.username) { syncEl.className = 'sync'; syncEl.textContent = 'Mag-login para mapasok sa ranking.'; }
        else if (!counted) { syncEl.className = 'sync'; syncEl.textContent = 'Masyadong maikli para sa ranking.'; }
        else { syncEl.className = 'sync wait'; syncEl.textContent = 'Sine-save sa ranking…'; }
        overEl.classList.add('show');
      }
      if (counted) {
        var cid = state.id;
        Sync.flush().then(function (left) {
          var syncEl2 = $('bbSync');
          if (!syncEl2) return;
          if (!Sync.has(cid)) { syncEl2.className = 'sync ok'; syncEl2.textContent = 'Na-save sa ranking.'; refreshBoard(); }
          else { syncEl2.className = 'sync wait'; syncEl2.textContent = 'Naka-queue — mase-sync pag bumalik ang internet.'; refreshBoard(); }
        });
      }
    }

    function startNew() {
      overEl.classList.remove('show');
      state = newState();
      locked = false;
      renderAll(true);
    }
    function onNewClick() {
      if (state && !state.over && state.moves >= 3 && state.score > 0) {
        if (!global.confirm('Tapusin ang kasalukuyang laro at i-save ang score na ' + fmt(state.score) + '?')) return;
        finish(false);
      } else if (state && !state.over) {
        lsDel(LS.state);
      }
      startNew();
    }

    // ── leaderboard UI ──
    var period = 'week';
    var lbSeq = 0;
    var segEl = $('bbSeg'), listEl = $('bbList'), noteEl = $('bbNote');
    function renderSeg() {
      segEl.innerHTML = PERIODS.map(function (p) {
        return '<button type="button" data-p="' + p[0] + '" aria-pressed="' + (p[0] === period) + '">' + p[1] + '</button>';
      }).join('') + '<button type="button" data-p="__refresh" aria-label="I-refresh" title="I-refresh" style="padding:7px 9px">' + ICON.refresh.replace('<svg', '<svg width="15" height="15"') + '</button>';
    }
    function timeAgo(ts) {
      if (!ts) return '';
      var m = Math.round((Date.now() - ts) / 60000);
      if (m < 1) return 'ngayon lang';
      if (m < 60) return m + ' min ang nakalipas';
      var h = Math.round(m / 60);
      return h < 24 ? h + ' oras ang nakalipas' : Math.round(h / 24) + ' araw ang nakalipas';
    }
    function rowHTML(entry, rank) {
      var mine = user.username && entry.username === user.username;
      var sub = [entry.department, entry.lines + ' lines', entry.combo >= 2 ? 'combo ×' + entry.combo : null].filter(Boolean).join(' · ');
      return '<li class="bb-row' + (mine ? ' me' : '') + (rank <= 3 ? ' r' + rank : '') + '">' +
        '<div class="bb-rk">' + rank + '</div>' +
        '<div class="bb-who"><b>' + esc(entry.fullname) + (mine ? ' (ikaw)' : '') + '</b><small>' + esc(sub) + '</small></div>' +
        '<div class="bb-pts">' + fmt(entry.score) + '<small>' + entry.games + ' laro' + (entry.pending ? ' · <span class="bb-pending-tag">hindi pa na-sync</span>' : '') + '</small></div>' +
        '</li>';
    }
    function renderBoardList(data) {
      var rows = data.rows;
      noteEl.className = 'bb-note';
      var notes = [];
      if (data.stale && netState() === 'offline') notes.push('Offline — ito ang huling nakuhang ranking' + (data.at ? ' (' + timeAgo(data.at) + ')' : '') + '.');
      else if (data.failed) { noteEl.className = 'bb-note warn'; notes.push('Hindi ma-load ang bagong ranking' + (data.at ? ' — ipinapakita ang huling kopya (' + timeAgo(data.at) + ')' : '') + '.'); }
      var q = Sync.queue().length;
      if (q) notes.push(q + ' score ang hindi pa na-sync. Mase-sync pag may internet.');
      noteEl.textContent = notes.join(' ');
      if (!rows.length) {
        listEl.innerHTML = '<li class="bb-empty">' + (period === 'today' ? 'Wala pang naglalaro ngayon.' : 'Wala pang score.') + ' Ikaw ang una.</li>';
        return;
      }
      var TOP = 15, html = '';
      rows.slice(0, TOP).forEach(function (e, n) { html += rowHTML(e, n + 1); });
      if (user.username && rows.length > TOP) {
        var idx = -1;
        rows.forEach(function (e, n) { if (e.username === user.username) idx = n; });
        if (idx >= TOP) html += '<li class="bb-row gap">⋮</li>' + rowHTML(rows[idx], idx + 1);
      }
      listEl.innerHTML = html;
    }
    function refreshBoard() {
      var seq = ++lbSeq;
      if (!listEl.children.length) listEl.innerHTML = '<li class="bb-skel"></li><li class="bb-skel"></li><li class="bb-skel"></li>';
      return loadBoard(period).then(function (data) { if (seq === lbSeq) renderBoardList(data); });
    }

    // ── net pill ──
    function setNet(st) {
      var el = $('bbNet');
      if (!el) return;
      el.setAttribute('data-state', st);
      el.querySelector('span').textContent = NET_TEXT[st] || st;
    }

    // ── events ──
    segEl.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      var p = b.getAttribute('data-p');
      if (p === '__refresh') { Sync.flush().then(refreshBoard); return; }
      period = p; renderSeg(); refreshBoard();
    });
    host.querySelector('.bb-tabs').addEventListener('click', function (e) {
      var b = e.target.closest('.bb-tab'); if (!b) return;
      var t = b.getAttribute('data-tab');
      wrap.setAttribute('data-tab', t);
      host.querySelectorAll('.bb-tab').forEach(function (x) { x.setAttribute('aria-selected', String(x === b)); });
      if (t === 'rank') refreshBoard(); else measure();
    });
    $('bbNew').addEventListener('click', onNewClick);
    $('bbAgain').addEventListener('click', startNew);
    $('bbSeeRank').addEventListener('click', function () {
      period = 'week'; renderSeg();
      var tab = host.querySelector('.bb-tab[data-tab="rank"]');
      if (tab && getComputedStyle(tab.parentNode).display !== 'none') tab.click(); else refreshBoard();
    });
    function paintSound() { var b = $('bbSound'); b.innerHTML = Sound.on ? ICON.on : ICON.off; b.title = Sound.on ? 'Patayin ang tunog' : 'Buksan ang tunog'; }
    $('bbSound').addEventListener('click', function () { Sound.set(!Sound.on); paintSound(); if (Sound.on) Sound.place(); });

    function onNet(e) {
      var st = (e && e.detail && e.detail.state) || netState();
      setNet(st);
      if (st !== 'offline') Sync.flush().then(function () { refreshBoard(); });
    }
    global.addEventListener('erp:net', onNet);
    global.addEventListener('online', function () { setNet(netState()); Sync.flush().then(refreshBoard); });
    global.addEventListener('offline', function () { setNet('offline'); });
    global.addEventListener('bb:synced', function () { refreshBoard(); });
    global.addEventListener('resize', measure);
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(measure).observe(boardEl);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') { measure(); Sync.flush().then(refreshBoard); }
    });
    setInterval(function () {
      if (document.visibilityState !== 'visible') return;
      if (Sync.queue().length) Sync.flush().then(refreshBoard);
      else if (netState() !== 'offline') refreshBoard();
    }, 60000);

    // ── init ──
    var saved = lsGet(LS.state, null);
    if (validState(saved)) { state = saved; state.lastAt = Date.now(); }
    else state = newState();
    paintSound();
    renderSeg();
    renderAll(false);
    measure();
    setNet(netState());
    refreshBoard();
    Sync.flush().then(function (left) { if (left === 0) refreshBoard(); });

    // Para sa offline.html: alamin kung may laro pang tumatakbo
    api.inProgress = function () { return !!(state && !state.over && state.moves > 0); };
    api._state = function () { return state; };
  }

  var api = {
    mount: mount,
    Engine: Engine,
    Sync: Sync,
    inProgress: function () { return false; },
    _rangeStart: rangeStart,
    _aggregate: aggregate
  };
  global.BlockBlast = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
