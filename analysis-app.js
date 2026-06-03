const pieceImagePaths = {
  'wP': 'https://upload.wikimedia.org/wikipedia/commons/4/45/Chess_plt45.svg',
  'wR': 'https://upload.wikimedia.org/wikipedia/commons/7/72/Chess_rlt45.svg',
  'wN': 'https://upload.wikimedia.org/wikipedia/commons/7/70/Chess_nlt45.svg',
  'wB': 'https://upload.wikimedia.org/wikipedia/commons/b/b1/Chess_blt45.svg',
  'wQ': 'https://upload.wikimedia.org/wikipedia/commons/1/15/Chess_qlt45.svg',
  'wK': 'https://upload.wikimedia.org/wikipedia/commons/4/42/Chess_klt45.svg',
  'bP': 'https://upload.wikimedia.org/wikipedia/commons/c/c7/Chess_pdt45.svg',
  'bR': 'https://upload.wikimedia.org/wikipedia/commons/f/ff/Chess_rdt45.svg',
  'bN': 'https://upload.wikimedia.org/wikipedia/commons/e/ef/Chess_ndt45.svg',
  'bB': 'https://upload.wikimedia.org/wikipedia/commons/9/98/Chess_bdt45.svg',
  'bQ': 'https://upload.wikimedia.org/wikipedia/commons/4/47/Chess_qdt45.svg',
  'bK': 'https://upload.wikimedia.org/wikipedia/commons/f/f0/Chess_kdt45.svg'
};

var game = new Chess();
let selectedSquare = null;
let validMoves = [];
let isFlipped = false;

// ДЕРЕВО ХОДОВ
let moveHistoryTree = { id: "root", parent: null, move: null, children: [] };
let activeNode = moveHistoryTree;

// Управление перетаскиванием
let isDragging = false;
let dragMovedEnough = false;
const DRAG_THRESHOLD = 8;
let dragStartX = 0;
let dragStartY = 0;
let dragClone = null;
let draggedPieceImg = null;
let draggedSquare = null;

let stockfishWorker = null;
let isStockfishReady = false;
let analysisLines = [];
let promotionFrom = null;
let promotionTo = null;

document.addEventListener('DOMContentLoaded', () => {
  initStockfish();
  renderBoard(true);
  updateStatus();
  updateMoveLog();

  document.getElementById('btn-new-game').addEventListener('click', startNewGame);
  document.getElementById('btn-flip').addEventListener('click', flipBoard);
  document.getElementById('btn-nav-first').addEventListener('click', () => jumpToMoveNode(moveHistoryTree));
  document.getElementById('btn-nav-prev').addEventListener('click', navigatePrev);
  document.getElementById('btn-nav-next').addEventListener('click', navigateNext);
  document.getElementById('btn-nav-last').addEventListener('click', navigateLast);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') navigatePrev();
    if (e.key === 'ArrowRight') navigateNext();
  });

  document.getElementById('engine-toggle').addEventListener('change', (e) => {
    if (!e.target.checked) {
      if (stockfishWorker) stockfishWorker.postMessage('stop');
      analysisLines = [];
      renderMultiPV();
      document.getElementById('analysis-engine-title-text').textContent = "ИИ выключен";
    } else {
      runAnalysisTask();
    }
  });

  document.getElementById('select-multipv').addEventListener('change', runAnalysisTask);
  document.getElementById('select-threads').addEventListener('change', runAnalysisTask);
});

function initStockfish() {
  try {
    const stockfishCDN = 'https://cdnjs.cloudflare.com/ajax/libs/stockfish.js/10.0.2/stockfish.js';
    const blobCode = `importScripts('${stockfishCDN}');`;
    stockfishWorker = new Worker(URL.createObjectURL(new Blob([blobCode], { type: 'application/javascript' })));
    stockfishWorker.onmessage = (e) => handleUCIResponse(e.data);
    stockfishWorker.postMessage('uci');
    stockfishWorker.postMessage('isready');
  } catch (err) { isStockfishReady = false; }
}

function handleUCIResponse(message) {
  if (message === 'readyok') { isStockfishReady = true; runAnalysisTask(); return; }
  if (message.startsWith('info')) {
    const dMatch = message.match(/depth (\d+)/);
    if (dMatch) document.getElementById('analysis-engine-title-text').textContent = `Анализ (глубина ${dMatch[1]})`;
    
    const multipvMatch = message.match(/multipv (\d+)/);
    const pvIndex = multipvMatch ? parseInt(multipvMatch[1]) - 1 : 0;

    let score = "0.00";
    if (message.includes('score cp')) {
      let cp = parseInt(message.match(/score cp (-?\d+)/)[1]);
      if (game.turn() === 'b') cp = -cp;
      score = (cp / 100).toFixed(2);
      if (pvIndex === 0) {
        updateEvaluationBar(cp);
        document.getElementById('engine-eval-val').textContent = score;
      }
    } else if (message.includes('score mate')) {
      const mMatch = message.match(/score mate (-?\d+)/);
      score = mMatch ? "M" + Math.abs(parseInt(mMatch[1])) : "M?";
      if (pvIndex === 0) document.getElementById('engine-eval-val').textContent = score;
    }

    const pvMatch = message.match(/ pv (.+)/);
    if (pvMatch) {
      const pvMoves = pvMatch[1].split(' ');
      analysisLines[pvIndex] = {
        score: score,
        move: pvMoves[0].substring(0, 2) + " → " + pvMoves[0].substring(2, 4),
        path: pvMoves.slice(1, 4).join(' ')
      };
      renderMultiPV();
    }
  }
}

function renderBoard(rebuildSquares = false) {
  const boardEl = document.getElementById('board');
  if (rebuildSquares) applySavedTheme();

  if (rebuildSquares || boardEl.children.length === 0) {
    boardEl.innerHTML = '';
    for (let r = 0; r < 8; r++) {
      const row = isFlipped ? r : (7 - r);
      for (let c = 0; c < 8; c++) {
        const col = isFlipped ? (7 - c) : c;
        const squareName = String.fromCharCode(97 + col) + (row + 1);
        const sq = document.createElement('div');
        sq.className = `square ${(row + col) % 2 !== 0 ? 'light' : 'dark'}`;
        sq.dataset.square = squareName;
        
        if (row === (isFlipped ? 7 : 0)) {
          const fl = document.createElement('span'); fl.className = 'coordinate file'; fl.textContent = String.fromCharCode(97 + col);
          sq.appendChild(fl);
        }
        if (col === (isFlipped ? 7 : 0)) {
          const rl = document.createElement('span'); rl.className = 'coordinate rank'; rl.textContent = row + 1;
          sq.appendChild(rl);
        }
        sq.addEventListener('pointerdown', (e) => handlePointerDown(e, squareName));
        boardEl.appendChild(sq);
      }
    }
  }

  boardEl.querySelectorAll('.square').forEach(sq => {
    const name = sq.dataset.square;
    const piece = game.get(name);
    sq.classList.remove('last-move', 'selected', 'check');
    if (activeNode.move && (name === activeNode.move.from || name === activeNode.move.to)) sq.classList.add('last-move');
    if (selectedSquare === name) sq.classList.add('selected');
    if (game.in_check() && piece && piece.type === 'k' && piece.color === game.turn()) sq.classList.add('check');
    let img = sq.querySelector('.piece');
    if (piece) {
      const src = pieceImagePaths[`${piece.color}${piece.type.toUpperCase()}`];
      if (!img) {
        img = document.createElement('img'); img.className = 'piece'; img.draggable = false;
        sq.appendChild(img);
      }
      img.src = src;
    } else if (img) sq.removeChild(img);
    let m = sq.querySelector('.move-dest, .move-dest-capture');
    if (validMoves.includes(name)) {
      const cls = piece ? 'move-dest-capture' : 'move-dest';
      if (!m || m.className !== cls) {
        if (m) sq.removeChild(m);
        m = document.createElement('div'); m.className = cls; sq.appendChild(m);
      }
    } else if (m) sq.removeChild(m);
  });
}

function handlePointerDown(e, square) {
  if (e.button !== 0 && e.pointerType === 'mouse') return;

  // 1. ПРОВЕРКА НА ХОД/ВЗЯТИЕ КЛИКОМ
  if (selectedSquare && validMoves.includes(square)) {
    attemptMove(selectedSquare, square);
    return;
  }

  const piece = game.get(square);
  if (piece) {
    isDragging = true;
    dragMovedEnough = false;
    draggedSquare = square;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    draggedPieceImg = e.target.classList.contains('piece') ? e.target : e.target.querySelector('.piece');
    
    // Если фигура своя - подсвечиваем варианты
    if (piece.color === game.turn()) {
      selectedSquare = square;
      validMoves = game.moves({ square: square, verbose: true }).map(m => m.to);
    } else {
      // Если чужая - только тащим (без точек)
      selectedSquare = null;
      validMoves = [];
    }

    renderBoard(false);
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    try { e.target.setPointerCapture(e.pointerId); } catch(err) {}
  } else {
    clearSelection();
  }
}

function handlePointerMove(e) {
  if (!isDragging || !draggedPieceImg) return;
  const dist = Math.hypot(e.clientX - dragStartX, e.clientY - dragStartY);
  if (dist > DRAG_THRESHOLD) {
    dragMovedEnough = true;
    if (!dragClone) {
      dragClone = draggedPieceImg.cloneNode(true);
      dragClone.className = 'piece drag-clone';
      dragClone.style.width = draggedPieceImg.offsetWidth + 'px';
      dragClone.style.height = draggedPieceImg.offsetHeight + 'px';
      document.body.appendChild(dragClone);
      draggedPieceImg.style.visibility = 'hidden';
    }
    dragClone.style.left = (e.clientX - dragClone.offsetWidth / 2) + 'px';
    dragClone.style.top = (e.clientY - dragClone.offsetHeight / 2) + 'px';
  }
}

function handlePointerUp(e) {
  if (!isDragging) return;
  isDragging = false;
  window.removeEventListener('pointermove', handlePointerMove);
  window.removeEventListener('pointerup', handlePointerUp);
  
  if (dragClone) { document.body.removeChild(dragClone); dragClone = null; }
  if (draggedPieceImg) draggedPieceImg.style.visibility = 'visible';

  const el = document.elementFromPoint(e.clientX, e.clientY);
  const sqEl = el ? el.closest('.square') : null;
  const target = sqEl ? sqEl.dataset.square : null;

  if (dragMovedEnough) {
    if (target && validMoves.includes(target)) {
      attemptMove(draggedSquare, target);
    } else {
      clearSelection();
    }
  } else {
    // Если это был просто клик, мы уже обработали выбор/ход в handlePointerDown
  }
}

function attemptMove(from, to) {
  const move = game.moves({ square: from, verbose: true }).find(m => m.to === to);
  if (!move) return;
  if (move.flags.includes('p')) { 
    promotionFrom = from; promotionTo = to; 
    document.getElementById('promotion-modal').classList.remove('hidden');
    renderPromotionChoices();
  } else {
    const res = game.move({ from, to });
    if (res) { 
      if (typeof playMoveSound === 'function') playMoveSound(res);
      recordMoveInTree(res); 
      finalizeMove(); 
    }
  }
}

function recordMoveInTree(res) {
  let child = activeNode.children.find(c => c.move.from === res.from && c.move.to === res.to && c.move.promotion === res.promotion);
  if (!child) {
    child = { id: Date.now(), parent: activeNode, move: { from: res.from, to: res.to, promotion: res.promotion, san: res.san }, children: [] };
    activeNode.children.push(child);
  }
  activeNode = child;
}

function finalizeMove() {
  selectedSquare = null; validMoves = [];
  renderBoard(true); updateMoveLog(); updateStatus(); runAnalysisTask();
}

function jumpToMoveNode(node) {
  if (!node) return;
  activeNode = node;
  const path = []; let temp = node;
  while (temp && temp.move) { path.push(temp.move); temp = temp.parent; }
  game = new Chess(); path.reverse().forEach(m => game.move(m));
  if (path.length > 0) chessSounds.move.play();
  finalizeMove();
}

function updateMoveLog() {
  const log = document.getElementById('move-log'); if (!log) return;
  log.innerHTML = ''; const path = []; let temp = activeNode;
  while (temp && temp.move) { path.push(temp); temp = temp.parent; }
  path.reverse();
  for (let i = 0; i < path.length; i += 2) {
    const row = document.createElement('div'); row.className = 'move-row';
    const w = path[i], b = path[i+1];
    row.innerHTML = `<span class="move-number">${(i/2)+1}.</span>
      <span class="move-text clickable-move ${w === activeNode ? 'active-move' : ''}" onclick="jumpToMoveNodeByRef(${i})">${w.move.san}</span>
      ${b ? `<span class="move-text clickable-move ${b === activeNode ? 'active-move' : ''}" onclick="jumpToMoveNodeByRef(${i+1})">${b.move.san}</span>`:''}`;
    log.appendChild(row);
  }
  updateBranchSelector();
}

window.jumpToMoveNodeByRef = function(idx) {
  const path = []; let temp = activeNode;
  while (temp && temp.move) { path.push(temp); temp = temp.parent; }
  path.reverse(); jumpToMoveNode(path[idx]);
};

function updateBranchSelector() {
  const panel = document.getElementById('branch-panel'), container = document.getElementById('branch-choices');
  const parent = activeNode.parent;
  if (parent && parent.children.length > 1) {
    panel.classList.remove('hidden-panel'); container.innerHTML = '';
    parent.children.forEach(c => {
      const btn = document.createElement('button'); btn.className = `btn btn-secondary branch-btn ${c===activeNode?'active-branch':''}`;
      btn.textContent = c.move.san; btn.onclick = () => jumpToMoveNode(c);
      container.appendChild(btn);
    });
  } else panel.classList.add('hidden-panel');
}

function runAnalysisTask() {
  if (!isStockfishReady || !document.getElementById('engine-toggle').checked) return;
  const multiPV = document.getElementById('select-multipv').value;
  const threads = document.getElementById('select-threads').value;
  stockfishWorker.postMessage('stop');
  analysisLines = [];
  stockfishWorker.postMessage(`setoption name MultiPV value ${multiPV}`);
  stockfishWorker.postMessage(`setoption name Threads value ${threads}`);
  stockfishWorker.postMessage(`position fen ${game.fen()}`);
  stockfishWorker.postMessage('go depth 18');
}

function renderMultiPV() {
  const container = document.getElementById('multipv-container'); if (!container) return;
  if (!document.getElementById('engine-toggle').checked) {
    container.innerHTML = '<div style="color:#555; font-size:0.8rem; text-align:center; padding:10px;">Движок выключен</div>';
    return;
  }
  container.innerHTML = '';
  analysisLines.forEach(line => {
    if (!line) return;
    const el = document.createElement('div'); el.className = 'pv-line';
    el.innerHTML = `<div class="pv-score">${line.score}</div><div class="pv-move">${line.move}</div><div class="pv-path">${line.path}...</div>`;
    container.appendChild(el);
  });
}

function updateEvaluationBar(cp) {
  const fill = document.getElementById('eval-fill'), text = document.getElementById('eval-text');
  let p = 50 + (Math.max(-800, Math.min(800, cp)) / 800) * 45;
  if (fill) fill.style.height = `${p}%`;
  if (text) text.textContent = (cp / 100).toFixed(1);
}

function navigatePrev() { if (activeNode.parent) jumpToMoveNode(activeNode.parent); }
function navigateNext() { if (activeNode.children.length > 0) jumpToMoveNode(activeNode.children[0]); }
function navigateLast() { let t = activeNode; while(t.children.length > 0) t = t.children[0]; jumpToMoveNode(t); }

function startNewGame() {
  game = new Chess(); moveHistoryTree = { id:"root", parent:null, move:null, children:[] };
  activeNode = moveHistoryTree; finalizeMove();
}

function flipBoard() { isFlipped = !isFlipped; renderBoard(true); }
function clearSelection() { selectedSquare = null; validMoves = []; renderBoard(false); }

function setBoardTheme(theme) {
  const board = document.getElementById('board'); if (!board) return;
  board.classList.remove('theme-brown', 'theme-green', 'theme-blue');
  board.classList.add(theme); localStorage.setItem('chess-board-theme', theme);
}
function applySavedTheme() { setBoardTheme(localStorage.getItem('chess-board-theme') || 'theme-brown'); }

function updateStatus() {
  const s = document.getElementById('status-text');
  s.textContent = game.in_checkmate() ? "Мат!" : (game.in_draw() ? "Ничья" : "Свободный анализ");
}

function renderPromotionChoices() {
  const container = document.querySelector('.promotion-choices'); container.innerHTML = '';
  ['q','r','b','n'].forEach(p => {
    const btn = document.createElement('button'); btn.className = 'promo-btn';
    btn.innerHTML = `<img src="${pieceImagePaths[game.turn()+p.toUpperCase()]}" class="piece">`;
    btn.onclick = () => {
      const res = game.move({ from: promotionFrom, to: promotionTo, promotion: p });
      if (res) { if (typeof playMoveSound === 'function') playMoveSound(res); recordMoveInTree(res); }
      document.getElementById('promotion-modal').classList.add('hidden'); finalizeMove();
    };
    container.appendChild(btn);
  });
}
