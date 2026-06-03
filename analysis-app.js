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
let selectedSquare = null, validMoves = [], isFlipped = false;
let moveHistoryTree = { id: "root", parent: null, move: null, children: [] };
let activeNode = moveHistoryTree;
let isDragging = false, dragStartX = 0, dragStartY = 0, dragClone = null, draggedPieceImg = null, draggedSquare = null;
let stockfishWorker = null, isStockfishReady = false, analysisLines = [];
let promotionFrom = null, promotionTo = null;

document.addEventListener('DOMContentLoaded', () => {
  initStockfish();
  renderBoard(true);
  updateStatus();
  updateMoveLog();

  document.getElementById('btn-new-game').onclick = startNewGame;
  document.getElementById('btn-flip').onclick = flipBoard;
  document.getElementById('btn-nav-first').onclick = () => jumpToMoveNode(moveHistoryTree);
  document.getElementById('btn-nav-prev').onclick = navigatePrev;
  document.getElementById('btn-nav-next').onclick = navigateNext;
  document.getElementById('btn-nav-last').onclick = navigateLast;

  document.getElementById('engine-toggle').onchange = (e) => {
    if (!e.target.checked) {
      if (stockfishWorker) stockfishWorker.postMessage('stop');
      analysisLines = []; renderMultiPV();
    } else runAnalysisTask();
  };
});

function initStockfish() {
  try {
    const workerCode = `importScripts('https://cdnjs.cloudflare.com/ajax/libs/stockfish.js/10.0.2/stockfish.js');`;
    stockfishWorker = new Worker(URL.createObjectURL(new Blob([workerCode], { type: 'application/javascript' })));
    stockfishWorker.onmessage = (e) => {
      if (e.data === 'readyok') { isStockfishReady = true; runAnalysisTask(); }
      if (e.data.startsWith('info')) handleAnalysisData(e.data);
    };
    stockfishWorker.postMessage('uci');
    stockfishWorker.postMessage('isready');
  } catch (err) { console.error(err); }
}

function handleAnalysisData(data) {
  const multipvMatch = data.match(/multipv (\d+)/);
  const pvIndex = multipvMatch ? parseInt(multipvMatch[1]) - 1 : 0;
  let score = "0.00";
  if (data.includes('score cp')) {
    let cp = parseInt(data.match(/score cp (-?\d+)/)[1]);
    if (game.turn() === 'b') cp = -cp;
    score = (cp / 100).toFixed(2);
    if (pvIndex === 0) updateEvaluationBar(cp);
  } else if (data.includes('score mate')) {
    score = "M" + Math.abs(data.match(/score mate (-?\d+)/)[1]);
  }
  const pvMatch = data.match(/ pv (.+)/);
  if (pvMatch) {
    const pvMoves = pvMatch[1].split(' ');
    analysisLines[pvIndex] = { score, move: pvMoves[0].substring(0,2)+"→"+pvMoves[0].substring(2,4), path: pvMoves.slice(1, 4).join(' ') };
    renderMultiPV();
  }
}

function renderBoard(rebuild = false) {
  const boardEl = document.getElementById('board');
  if (rebuild) {
    const theme = localStorage.getItem('chess-board-theme') || 'theme-brown';
    boardEl.className = 'chessboard ' + theme;
    boardEl.innerHTML = '';
    for (let r = 0; r < 8; r++) {
      const row = isFlipped ? r : (7 - r);
      for (let c = 0; c < 8; c++) {
        const col = isFlipped ? (7 - c) : c;
        const name = String.fromCharCode(97 + col) + (row + 1);
        const sq = document.createElement('div');
        sq.className = `square ${(row + col) % 2 !== 0 ? 'light' : 'dark'}`;
        sq.dataset.square = name;
        sq.onpointerdown = (e) => handlePointerDown(e, name);
        boardEl.appendChild(sq);
      }
    }
  }
  boardEl.querySelectorAll('.square').forEach(sq => {
    const name = sq.dataset.square, piece = game.get(name);
    sq.classList.remove('last-move', 'selected', 'check');
    if (activeNode.move && (name === activeNode.move.from || name === activeNode.move.to)) sq.classList.add('last-move');
    if (selectedSquare === name) sq.classList.add('selected');
    if (game.in_check() && piece && piece.type === 'k' && piece.color === game.turn()) sq.classList.add('check');
    let img = sq.querySelector('.piece');
    if (piece) {
      const src = pieceImagePaths[`${piece.color}${piece.type.toUpperCase()}`];
      if (!img) { img = document.createElement('img'); img.className = 'piece'; img.draggable = false; sq.appendChild(img); }
      img.src = src;
    } else if (img) sq.removeChild(img);
    let m = sq.querySelector('.move-dest, .move-dest-capture');
    if (validMoves.includes(name)) {
      const cls = piece ? 'move-dest-capture' : 'move-dest';
      if (!m || m.className !== cls) { if (m) sq.removeChild(m); m = document.createElement('div'); m.className = cls; sq.appendChild(m); }
    } else if (m) sq.removeChild(m);
  });
}

function handlePointerDown(e, sq) {
  if (typeof unlockAudio === 'function') unlockAudio();
  if (selectedSquare && validMoves.includes(sq)) { attemptMove(selectedSquare, sq); return; }
  const piece = game.get(sq);
  if (piece) {
    isDragging = true; draggedSquare = sq; dragStartX = e.clientX; dragStartY = e.clientY;
    draggedPieceImg = e.target.classList.contains('piece') ? e.target : e.target.querySelector('.piece');
    if (piece.color === game.turn()) { selectedSquare = sq; validMoves = game.moves({ square: sq, verbose: true }).map(m => m.to); }
    else { selectedSquare = null; validMoves = []; }
    renderBoard(false);
    window.onpointermove = handlePointerMove;
    window.onpointerup = handlePointerUp;
    try { e.target.setPointerCapture(e.pointerId); } catch(err) {}
  } else clearSelection();
}

function handlePointerMove(e) {
  if (!isDragging || !draggedPieceImg) return;
  const dist = Math.hypot(e.clientX - dragStartX, e.clientY - dragStartY);
  if (dist > 5) {
    if (!dragClone) {
      dragClone = draggedPieceImg.cloneNode(true);
      dragClone.className = 'piece drag-clone';
      // ФИКС РАЗМЕРА ФИГУРЫ
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
  isDragging = false; window.onpointermove = null; window.onpointerup = null;
  if (dragClone) { document.body.removeChild(dragClone); dragClone = null; }
  if (draggedPieceImg) draggedPieceImg.style.visibility = 'visible';
  const el = document.elementFromPoint(e.clientX, e.clientY);
  const target = el?.closest('.square')?.dataset.square;
  if (target && validMoves.includes(target)) attemptMove(draggedSquare, target);
  else renderBoard(false);
}

function attemptMove(f, t) {
  const res = game.move({ from: f, to: t, promotion: 'q' });
  if (res) {
    if (window.playMoveSound) playMoveSound(res);
    let child = activeNode.children.find(c => c.move.san === res.san);
    if (!child) { child = { id: Date.now(), parent: activeNode, move: res, children: [] }; activeNode.children.push(child); }
    activeNode = child; finalizeMove();
  }
}

function finalizeMove() { selectedSquare = null; validMoves = []; renderBoard(true); updateMoveLog(); updateStatus(); runAnalysisTask(); }
function jumpToMoveNode(node) {
  if (!node) return; activeNode = node; const path = []; let t = node;
  while (t && t.move) { path.push(t.move); t = t.parent; }
  game = new Chess(); path.reverse().forEach(m => game.move(m));
  finalizeMove();
}
function updateMoveLog() {
  const log = document.getElementById('move-log'); if (!log) return; log.innerHTML = '';
  const path = []; let t = activeNode; while (t && t.move) { path.push(t); t = t.parent; } path.reverse();
  for (let i = 0; i < path.length; i += 2) {
    const row = document.createElement('div'); row.className = 'move-row';
    row.innerHTML = `<span style="color:#666;width:25px;display:inline-block;">${(i/2)+1}.</span>
    <span class="move-text ${path[i]===activeNode?'active-move':''}" style="cursor:pointer;padding:0 5px;" onclick="jumpToMoveByRef(${i})">${path[i].move.san}</span>
    ${path[i+1] ? `<span class="move-text ${path[i+1]===activeNode?'active-move':''}" style="cursor:pointer;padding:0 5px;" onclick="jumpToMoveByRef(${i+1})">${path[i+1].move.san}</span>` : ''}`;
    log.appendChild(row);
  }
}
window.jumpToMoveByRef = (idx) => {
  const path = []; let t = activeNode; while (t && t.move) { path.push(t); t = t.parent; } path.reverse();
  jumpToMoveNode(path[idx]);
};
function navigatePrev() { if (activeNode.parent) jumpToMoveNode(activeNode.parent); }
function navigateNext() { if (activeNode.children.length > 0) jumpToMoveNode(activeNode.children[0]); }
function navigateLast() { let t = activeNode; while(t.children.length > 0) t = t.children[0]; jumpToMoveNode(t); }
function startNewGame() { game = new Chess(); moveHistoryTree = { id:"root", parent:null, move:null, children:[] }; activeNode = moveHistoryTree; finalizeMove(); }
function flipBoard() { isFlipped = !isFlipped; renderBoard(true); }
function clearSelection() { selectedSquare = null; validMoves = []; renderBoard(false); }
function updateStatus() { document.getElementById('status-text').textContent = game.in_checkmate() ? "Мат!" : "Свободный анализ"; }
function runAnalysisTask() {
  if (!isStockfishReady || !document.getElementById('engine-toggle').checked) return;
  stockfishWorker.postMessage('stop');
  stockfishWorker.postMessage('setoption name MultiPV value 3');
  stockfishWorker.postMessage(`position fen ${game.fen()}`);
  stockfishWorker.postMessage('go depth 16');
}
function renderMultiPV() {
  const container = document.getElementById('multipv-container');
  if (!container || !document.getElementById('engine-toggle').checked) return;
  container.innerHTML = analysisLines.map(line => `
    <div style="display:flex;gap:10px;font-family:monospace;font-size:0.85rem;background:rgba(255,255,255,0.05);padding:5px;margin-bottom:2px;">
      <div style="font-weight:bold;color:#fff;">${line.score}</div>
      <div style="color:#258039;">${line.move}</div>
      <div style="color:#777;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${line.path}</div>
    </div>
  `).join('');
}
function updateEvaluationBar(cp) {
  const fill = document.getElementById('eval-fill'), text = document.getElementById('eval-text');
  let p = 50 + (Math.max(-800, Math.min(800, cp)) / 800) * 45;
  if (fill) fill.style.height = `${p}%`;
  if (text) text.textContent = (cp / 100).toFixed(1);
}
