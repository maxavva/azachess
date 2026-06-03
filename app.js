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

const AI_LEVELS = {
  1: { skill: 0, depth: 1 }, 2: { skill: 3, depth: 2 }, 3: { skill: 6, depth: 4 },
  4: { skill: 10, depth: 6 }, 5: { skill: 14, depth: 8 }, 6: { skill: 17, depth: 12 },
  7: { skill: 20, depth: 15 }, 8: { skill: 20, depth: 20 }
};

// liveGame - актуальное состояние (таймер, ИИ)
// displayGame - то, что мы видим на экране
var liveGame = new Chess();
var displayGame = new Chess();

let selectedSquare = null, validMoves = [], isFlipped = false, fullMoveHistory = [], currentMoveIndex = 0; 
let timerInterval = null, whiteTime = 300, blackTime = 300, increment = 3, isClockEnabled = true, isGameStarted = false;
let isDragging = false, dragMovedEnough = false, dragStartX = 0, dragStartY = 0, dragClone = null, draggedPieceImg = null, draggedSquare = null;
let stockfishWorker = null, isStockfishReady = false, isWaitingForAIMove = false;
let promotionFrom = null, promotionTo = null;
const DRAG_THRESHOLD = 5;

function initApp() {
  if (typeof Chess === 'undefined') {
    setTimeout(initApp, 100);
    return;
  }
  initStockfish();
  
  const setupBtn = (id, fn) => { const el = document.getElementById(id); if (el) el.onclick = fn; };
  setupBtn('btn-new-game', startNewGame);
  setupBtn('btn-flip', flipBoard);
  setupBtn('btn-nav-first', () => jumpToMoveIndex(0));
  setupBtn('btn-nav-prev', () => jumpToMoveIndex(currentMoveIndex - 1));
  setupBtn('btn-nav-next', () => jumpToMoveIndex(currentMoveIndex + 1));
  setupBtn('btn-nav-last', () => jumpToMoveIndex(fullMoveHistory.length));

  resetGameSettings();
}

document.addEventListener('DOMContentLoaded', initApp);

function initStockfish() {
  try {
    const blobCode = `importScripts('https://cdnjs.cloudflare.com/ajax/libs/stockfish.js/10.0.2/stockfish.js');`;
    stockfishWorker = new Worker(URL.createObjectURL(new Blob([blobCode], { type: 'application/javascript' })));
    stockfishWorker.onmessage = (e) => {
      if (e.data === 'readyok') isStockfishReady = true;
      if (e.data.startsWith('bestmove') && isWaitingForAIMove) {
        isWaitingForAIMove = false;
        if (isClockEnabled && (whiteTime <= 0 || blackTime <= 0)) return;
        const move = e.data.split(' ')[1];
        if (move && move !== '(none)') {
          const res = liveGame.move({ from: move.substring(0, 2), to: move.substring(2, 4), promotion: move[4] || 'q' });
          if (res) {
            if (window.playMoveSound) playMoveSound(res);
            fullMoveHistory.push(res);
            // Если мы смотрим последний ход, автоматически двигаем доску вперед
            const wasAtEnd = (currentMoveIndex === fullMoveHistory.length - 1);
            if (wasAtEnd) currentMoveIndex = fullMoveHistory.length;
            syncDisplayGame();
            onMoveExecution();
          }
        }
      }
    };
    stockfishWorker.postMessage('uci');
    stockfishWorker.postMessage('isready');
  } catch (err) { console.error("Stockfish Error:", err); }
}

function renderBoard(rebuildSquares = false) {
  const boardEl = document.getElementById('board');
  if (!boardEl) return;
  if (rebuildSquares) {
    const savedTheme = localStorage.getItem('chess-board-theme') || 'theme-brown';
    boardEl.classList.remove('theme-brown', 'theme-green', 'theme-blue');
    boardEl.classList.add(savedTheme);
  }
  
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
        sq.onpointerdown = (e) => handlePointerDown(e, squareName);
        boardEl.appendChild(sq);
      }
    }
  }

  boardEl.querySelectorAll('.square').forEach(sq => {
    const name = sq.dataset.square, piece = displayGame.get(name);
    sq.classList.remove('last-move', 'selected', 'check');
    
    // Подсветка последнего хода в ИСТОРИИ
    const last = fullMoveHistory[currentMoveIndex - 1];
    if (last && (name === last.from || name === last.to)) sq.classList.add('last-move');
    if (selectedSquare === name) sq.classList.add('selected');
    if (displayGame.in_check() && piece && piece.type === 'k' && piece.color === displayGame.turn()) sq.classList.add('check');
    
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
  if (e.button !== 0 || liveGame.game_over() || isWaitingForAIMove) return;
  
  // Если мы листаем историю - запрещаем делать ходы
  if (currentMoveIndex < fullMoveHistory.length) return;

  const piece = liveGame.get(square);
  const playerColor = isFlipped ? 'b' : 'w';
  const myTurn = liveGame.turn() === playerColor;
  
  if (!myTurn) return;

  isDragging = true; dragMovedEnough = false; draggedSquare = square;
  dragStartX = e.clientX; dragStartY = e.clientY;
  draggedPieceImg = e.target.classList.contains('piece') ? e.target : e.target.querySelector('.piece');
  
  if (piece && piece.color === playerColor) {
    validMoves = liveGame.moves({ square: square, verbose: true }).map(m => m.to);
    renderBoard(false); 
  }
  window.onpointermove = handlePointerMove;
  window.onpointerup = handlePointerUp;
}

function handlePointerMove(e) {
  if (!isDragging) return;
  const dist = Math.hypot(e.clientX - dragStartX, e.clientY - dragStartY);
  if (dist > DRAG_THRESHOLD && draggedPieceImg && !dragClone) {
    dragMovedEnough = true;
    dragClone = draggedPieceImg.cloneNode(true);
    dragClone.className = 'piece drag-clone';
    dragClone.style.width = draggedPieceImg.offsetWidth + 'px';
    dragClone.style.height = draggedPieceImg.offsetHeight + 'px';
    document.body.appendChild(dragClone);
    draggedPieceImg.style.visibility = 'hidden';
  }
  if (dragClone) {
    dragClone.style.left = (e.clientX - dragClone.offsetWidth / 2) + 'px';
    dragClone.style.top = (e.clientY - dragClone.offsetHeight / 2) + 'px';
  }
}

function handlePointerUp(e) {
  isDragging = false; window.onpointermove = null; window.onpointerup = null;
  if (dragClone) { document.body.removeChild(dragClone); dragClone = null; }
  if (draggedPieceImg) draggedPieceImg.style.visibility = 'visible';
  
  const el = document.elementFromPoint(e.clientX, e.clientY);
  const sqEl = el ? el.closest('.square') : null;
  const target = sqEl ? sqEl.dataset.square : null;

  if (dragMovedEnough && target && validMoves.includes(target)) {
    attemptMove(draggedSquare, target);
  } else if (!dragMovedEnough) {
    const piece = liveGame.get(draggedSquare);
    const playerColor = isFlipped ? 'b' : 'w';
    if (piece && piece.color === playerColor) {
      if (selectedSquare === draggedSquare) clearSelection();
      else { 
        selectedSquare = draggedSquare; 
        validMoves = liveGame.moves({ square: draggedSquare, verbose: true }).map(m => m.to); 
        renderBoard(false); 
      }
    } else if (selectedSquare && validMoves.includes(draggedSquare)) {
      attemptMove(selectedSquare, draggedSquare);
    } else clearSelection();
  } else clearSelection();
}

function attemptMove(from, to) {
  if (isClockEnabled && isGameStarted && (whiteTime <= 0 || blackTime <= 0)) return clearSelection();
  const moves = liveGame.moves({ square: from, verbose: true });
  const move = moves.find(m => m.to === to);
  if (!move) return clearSelection();

  if (move.flags.includes('p')) {
    promotionFrom = from; promotionTo = to;
    document.getElementById('promotion-modal').classList.remove('hidden');
    renderPromotionChoices();
    return;
  }

  const res = liveGame.move({ from: from, to: to });
  if (res) {
    if (window.playMoveSound) playMoveSound(res);
    fullMoveHistory.push(res);
    currentMoveIndex = fullMoveHistory.length;
    syncDisplayGame();
    onMoveExecution();
  }
}

function renderPromotionChoices() {
  const container = document.querySelector('.promotion-choices');
  if (!container) return;
  container.innerHTML = '';
  const turn = liveGame.turn();
  ['q', 'r', 'b', 'n'].forEach(p => {
    const btn = document.createElement('button');
    btn.className = 'promo-btn';
    btn.innerHTML = `<img src="${pieceImagePaths[turn + p.toUpperCase()]}" style="width:100%;">`;
    btn.onclick = () => {
      const res = liveGame.move({ from: promotionFrom, to: promotionTo, promotion: p });
      if (res) {
        if (window.playMoveSound) playMoveSound(res);
        fullMoveHistory.push(res);
        currentMoveIndex = fullMoveHistory.length;
        syncDisplayGame();
        document.getElementById('promotion-modal').classList.add('hidden');
        onMoveExecution();
      }
    };
    container.appendChild(btn);
  });
}

function onMoveExecution() {
  if (!isGameStarted) isGameStarted = true;
  if (isClockEnabled) {
    if (liveGame.turn() === 'b') whiteTime += increment;
    else blackTime += increment;
  }
  clearSelection(); updateMoveLog(); updateStatus(); updateClockDisplay();
  if (!liveGame.game_over()) {
    if (isClockEnabled) startTimer();
    checkAndTriggerAI();
  } else stopTimer();
}

function checkAndTriggerAI() {
  const playerColor = isFlipped ? 'b' : 'w';
  if (liveGame.turn() !== playerColor && !liveGame.game_over()) {
    triggerEngineMove();
  }
}

function resetGameSettings() {
  stopTimer(); 
  liveGame = new Chess(); 
  displayGame = new Chess();
  fullMoveHistory = []; 
  currentMoveIndex = 0; 
  isGameStarted = false;
  const timeVal = localStorage.getItem('selected-time-control') || '5+3';
  const cw = document.getElementById('clocks-wrapper');
  if (timeVal === 'none') { isClockEnabled = false; if(cw) cw.style.display = 'none'; }
  else {
    isClockEnabled = true; if(cw) cw.style.display = 'flex';
    const parts = timeVal.split('+');
    whiteTime = parseInt(parts[0]) * 60; blackTime = whiteTime; increment = parseInt(parts[1]) || 0;
  }
  updateClockDisplay(); clearSelection(); updateMoveLog(); updateStatus(); renderBoard(true);
  checkAndTriggerAI();
}

function startTimer() {
  stopTimer();
  if (!isClockEnabled || !isGameStarted) return;
  timerInterval = setInterval(() => {
    // ВРЕМЯ ВСЕГДА СЛЕДУЕТ ЗА liveGame
    if (liveGame.turn() === 'w') whiteTime--; else blackTime--;
    if (whiteTime <= 0 || blackTime <= 0) {
      whiteTime = Math.max(0, whiteTime); blackTime = Math.max(0, blackTime);
      stopTimer(); updateStatus();
      if (window.chessSounds && chessSounds.gameEnd) chessSounds.gameEnd.play();
    }
    updateClockDisplay();
  }, 1000);
}

function stopTimer() { if (timerInterval) clearInterval(timerInterval); timerInterval = null; }

function updateClockDisplay() {
  const t = document.getElementById('clock-top'), b = document.getElementById('clock-bottom');
  if (!t || !b) return;
  const format = (s) => `${Math.floor(s/60)}:${(s%60).toString().padStart(2, '0')}`;
  
  const wClock = isFlipped ? t : b;
  const bClock = isFlipped ? b : t;
  wClock.textContent = format(whiteTime);
  bClock.textContent = format(blackTime);
  
  // ПОДСВЕТКА ВСЕГДА ПО liveGame
  const turn = liveGame.turn();
  const isActive = isGameStarted && !liveGame.game_over() && whiteTime > 0 && blackTime > 0;
  t.classList.toggle('active', isActive && ((isFlipped && turn === 'w') || (!isFlipped && turn === 'b')));
  b.classList.toggle('active', isActive && ((!isFlipped && turn === 'w') || (isFlipped && turn === 'b')));
}

function updateStatus() {
  const s = document.getElementById('status-text'); if (!s) return;
  if (isClockEnabled && isGameStarted && whiteTime <= 0) s.textContent = 'Белые: время вышло!';
  else if (isClockEnabled && isGameStarted && blackTime <= 0) s.textContent = 'Черные: время вышло!';
  else if (liveGame.in_checkmate()) s.textContent = `Мат!`;
  else s.textContent = liveGame.turn()==='w' ? 'Ход белых' : 'Ход черных';
}

function triggerEngineMove() {
  if (!isStockfishReady || isWaitingForAIMove) return;
  const lv = localStorage.getItem('selected-ai-level') || 3;
  const cfg = AI_LEVELS[lv] || AI_LEVELS[3];
  isWaitingForAIMove = true;
  stockfishWorker.postMessage(`setoption name Skill Level value ${cfg.skill}`);
  stockfishWorker.postMessage(`position fen ${liveGame.fen()}`);
  stockfishWorker.postMessage(`go depth ${cfg.depth}`);
}

function startNewGame() { resetGameSettings(); }
function clearSelection() { selectedSquare = null; validMoves = []; renderBoard(false); }
function flipBoard() { isFlipped = !isFlipped; clearSelection(); renderBoard(true); updateClockDisplay(); }

function updateMoveLog() {
  const log = document.getElementById('move-log'); if(!log) return;
  log.innerHTML = '';
  for (let i = 0; i < fullMoveHistory.length; i += 2) {
    const row = document.createElement('div'); row.className = 'move-row';
    const wMove = fullMoveHistory[i];
    const bMove = fullMoveHistory[i+1];
    
    row.innerHTML = `<span class="move-number">${Math.floor(i/2)+1}.</span>
      <span class="move-text clickable-move ${i+1===currentMoveIndex?'active-move':''}" onclick="jumpToMoveIndex(${i+1})">${wMove.san}</span>
      ${bMove ? `<span class="move-text clickable-move ${i+2===currentMoveIndex?'active-move':''}" onclick="jumpToMoveIndex(${i+2})">${bMove.san}</span>` : ''}`;
    log.appendChild(row);
  }
}

function jumpToMoveIndex(idx) {
  if (idx < 0 || idx > fullMoveHistory.length) return;
  currentMoveIndex = idx;
  syncDisplayGame();
  renderBoard(false);
  updateMoveLog();
  // updateStatus и updateClockDisplay теперь не зависят от просматриваемого хода
}

function syncDisplayGame() {
  displayGame = new Chess();
  for (let i = 0; i < currentMoveIndex; i++) {
    displayGame.move(fullMoveHistory[i]);
  }
}
