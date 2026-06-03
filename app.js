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
  1: { skill: 0, depth: 1 },
  2: { skill: 3, depth: 2 },
  3: { skill: 6, depth: 4 },
  4: { skill: 10, depth: 6 },
  5: { skill: 14, depth: 8 },
  6: { skill: 17, depth: 12 },
  7: { skill: 20, depth: 15 },
  8: { skill: 20, depth: 20 }
};

let game = new Chess();
let selectedSquare = null;
let validMoves = [];
let isFlipped = false;
let fullMoveHistory = []; 
let currentMoveIndex = 0; 

// Время
let timerInterval = null;
let whiteTime = 300;
let blackTime = 300;
let increment = 3;
let isClockEnabled = true;
let isGameStarted = false;

// Управление
let isDragging = false;
let dragMovedEnough = false; 
const DRAG_THRESHOLD = 5;   
let dragStartX = 0;
let dragStartY = 0;
let dragClone = null;
let draggedPieceImg = null;
let draggedSquare = null;

let stockfishWorker = null;
let isStockfishReady = false;
let isWaitingForAIMove = false;
let stockfishWatchdogTimer = null; 

let promotionFrom = null;
let promotionTo = null;

document.addEventListener('DOMContentLoaded', () => {
  initStockfish();
  
  // Привязка кнопок времени
  const timeBtns = document.querySelectorAll('.time-btn');
  timeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      timeBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      startNewGame();
    });
  });

  document.getElementById('btn-new-game').addEventListener('click', startNewGame);
  document.getElementById('btn-flip').addEventListener('click', flipBoard);
  document.getElementById('btn-nav-first').addEventListener('click', () => jumpToMoveIndex(0));
  document.getElementById('btn-nav-prev').addEventListener('click', () => jumpToMoveIndex(currentMoveIndex - 1));
  document.getElementById('btn-nav-next').addEventListener('click', () => jumpToMoveIndex(currentMoveIndex + 1));
  document.getElementById('btn-nav-last').addEventListener('click', () => jumpToMoveIndex(fullMoveHistory.length));

  document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') jumpToMoveIndex(currentMoveIndex - 1);
    if (e.key === 'ArrowRight') jumpToMoveIndex(currentMoveIndex + 1);
  });

  // Запуск начального состояния
  resetGameSettings();
});

function initStockfish() {
  try {
    const stockfishCDN = 'https://cdnjs.cloudflare.com/ajax/libs/stockfish.js/10.0.2/stockfish.js';
    const blobCode = `importScripts('${stockfishCDN}');`;
    stockfishWorker = new Worker(URL.createObjectURL(new Blob([blobCode], { type: 'application/javascript' })));
    stockfishWorker.onmessage = (e) => handleUCIResponse(e.data);
    stockfishWorker.postMessage('uci');
    stockfishWorker.postMessage('isready');
  } catch (err) { console.error("Stockfish Error:", err); }
}

function handleUCIResponse(message) {
  if (message === 'readyok') isStockfishReady = true;
  if (message.startsWith('bestmove') && isWaitingForAIMove) {
    if (stockfishWatchdogTimer) clearTimeout(stockfishWatchdogTimer);
    isWaitingForAIMove = false;
    const move = message.split(' ')[1];
    if (move && move !== '(none)') {
      const res = game.move({ from: move.substring(0, 2), to: move.substring(2, 4), promotion: move[4] || 'q' });
      if (res) {
        // И ЗДЕСЬ ТОЖЕ:
        if (typeof playMoveSound === 'function') playMoveSound(res);

        fullMoveHistory.push({ from: res.from, to: res.to, promotion: res.promotion, san: res.san });
        currentMoveIndex = fullMoveHistory.length;
        onMoveExecution();
      }
    }
  }
}

function renderBoard(rebuildSquares = false) {
  const boardEl = document.getElementById('board');
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
        sq.addEventListener('pointerdown', (e) => handlePointerDown(e, squareName));
        boardEl.appendChild(sq);
      }
    }
  }

  boardEl.querySelectorAll('.square').forEach(sq => {
    const name = sq.dataset.square;
    const piece = game.get(name);
    sq.classList.remove('last-move', 'selected', 'check');
    const last = fullMoveHistory[currentMoveIndex - 1];
    if (last && (name === last.from || name === last.to)) sq.classList.add('last-move');
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
  if (game.game_over() || isWaitingForAIMove) return;
  const playerColor = isFlipped ? 'b' : 'w';
  const piece = game.get(square);
  isDragging = true; dragMovedEnough = false; draggedSquare = square;
  dragStartX = e.clientX; dragStartY = e.clientY;
  draggedPieceImg = e.target.classList.contains('piece') ? e.target : e.target.querySelector('.piece');
  if (piece && piece.color === playerColor) {
    validMoves = game.moves({ square: square, verbose: true }).map(m => m.to);
    renderBoard(false); 
  }
  window.addEventListener('pointermove', handlePointerMove);
  window.addEventListener('pointerup', handlePointerUp);
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
  if (!isDragging) return;
  isDragging = false;
  window.removeEventListener('pointermove', handlePointerMove);
  window.removeEventListener('pointerup', handlePointerUp);
  if (dragClone) { document.body.removeChild(dragClone); dragClone = null; }
  if (draggedPieceImg) draggedPieceImg.style.visibility = 'visible';
  const el = document.elementFromPoint(e.clientX, e.clientY);
  const sqEl = el ? el.closest('.square') : null;
  const target = sqEl ? sqEl.dataset.square : null;
  const playerColor = isFlipped ? 'b' : 'w';
  if (dragMovedEnough) {
    if (target && validMoves.includes(target)) attemptMove(draggedSquare, target);
    else clearSelection();
  } else {
    const piece = game.get(draggedSquare);
    if (piece && piece.color === playerColor) {
      if (selectedSquare === draggedSquare) clearSelection();
      else {
        selectedSquare = draggedSquare;
        validMoves = game.moves({ square: draggedSquare, verbose: true }).map(m => m.to);
        renderBoard(false);
      }
    } else if (selectedSquare && validMoves.includes(draggedSquare)) attemptMove(selectedSquare, draggedSquare);
    else clearSelection();
  }
}

function attemptMove(from, to) {
  const move = game.moves({ square: from, verbose: true }).find(m => m.to === to);
  if (!move) return clearSelection();

  if (move.flags.includes('p')) {
    promotionFrom = from; promotionTo = to;
    document.getElementById('promotion-modal').classList.remove('hidden');
    renderPromotionChoices();
  } else {
    const res = game.move({ from, to });
    if (res) {
      // ВОТ ЭТА СТРОКА ВАЖНА:
      if (typeof playMoveSound === 'function') playMoveSound(res);
      
      fullMoveHistory.push({ from: res.from, to: res.to, promotion: res.promotion, san: res.san });
      currentMoveIndex = fullMoveHistory.length;
      onMoveExecution();
    }
  }
}

function onMoveExecution() {
  if (!isGameStarted) isGameStarted = true;
  if (isClockEnabled) {
    if (game.turn() === 'b') whiteTime += increment;
    else blackTime += increment;
  }
  clearSelection(); updateMoveLog(); updateStatus(); updateClockDisplay();
  if (game.game_over()) stopTimer();
  else {
    if (isClockEnabled && isGameStarted) startTimer();
    const pc = isFlipped ? 'b' : 'w';
    if (game.turn() !== pc) triggerEngineMove();
  }
}

function startNewGame() { resetGameSettings(); }

function resetGameSettings() {
  stopTimer();
  game = new Chess();
  fullMoveHistory = [];
  currentMoveIndex = 0;
  isGameStarted = false;
  const activeBtn = document.querySelector('.time-btn.active');
  const timeVal = activeBtn ? activeBtn.getAttribute('data-time') : '5+3';
  if (timeVal === 'none') {
    isClockEnabled = false;
    document.getElementById('clocks-wrapper').style.display = 'none';
  } else {
    isClockEnabled = true;
    document.getElementById('clocks-wrapper').style.display = 'flex';
    const parts = timeVal.split('+');
    whiteTime = parseInt(parts[0]) * 60;
    blackTime = whiteTime;
    increment = parseInt(parts[1]) || 0;
  }
  updateClockDisplay();
  clearSelection();
  updateMoveLog();
  updateStatus();
  renderBoard(true);
}

function startTimer() {
  stopTimer();
  if (!isClockEnabled || !isGameStarted) return;
  timerInterval = setInterval(() => {
    if (game.turn() === 'w') whiteTime--; else blackTime--;
    if (whiteTime <= 0 || blackTime <= 0) {
      whiteTime = Math.max(0, whiteTime); blackTime = Math.max(0, blackTime);
      stopTimer(); updateStatus();
    }
    updateClockDisplay();
  }, 1000);
}

function stopTimer() { if (timerInterval) clearInterval(timerInterval); timerInterval = null; }

function updateClockDisplay() {
  if (!isClockEnabled) return;
  const top = document.getElementById('clock-top'), bottom = document.getElementById('clock-bottom');
  const format = (s) => `${Math.floor(s/60)}:${(s%60).toString().padStart(2, '0')}`;
  const wClock = isFlipped ? top : bottom, bClock = isFlipped ? bottom : top;
  wClock.textContent = format(whiteTime); bClock.textContent = format(blackTime);
  const turn = game.turn();
  top.classList.toggle('active', isGameStarted && ((isFlipped && turn === 'w') || (!isFlipped && turn === 'b')));
  bottom.classList.toggle('active', isGameStarted && ((!isFlipped && turn === 'w') || (isFlipped && turn === 'b')));
}

function triggerEngineMove() {
  const lv = document.getElementById('ai-depth').value;
  const cfg = AI_LEVELS[lv] || AI_LEVELS[3];
  if (isStockfishReady && stockfishWorker) {
    isWaitingForAIMove = true;
    document.getElementById('status-text').textContent = `ИИ думает...`;
    stockfishWorker.postMessage(`setoption name Skill Level value ${cfg.skill}`);
    stockfishWorker.postMessage(`position fen ${game.fen()}`);
    stockfishWorker.postMessage(`go depth ${cfg.depth}`);
  }
}

function updateStatus() {
  const s = document.getElementById('status-text');
  if (game.in_checkmate()) s.textContent = `Мат! Победили ${game.turn()==='w'?'Черные':'Белые'}`;
  else if (game.in_draw()) s.textContent = 'Ничья';
  else if (isClockEnabled && whiteTime <= 0) s.textContent = 'Белые: время вышло!';
  else if (isClockEnabled && blackTime <= 0) s.textContent = 'Черные: время вышло!';
  else s.textContent = game.turn()==='w' ? 'Ход белых' : 'Ход черных';
}

function clearSelection() { selectedSquare = null; validMoves = []; renderBoard(false); }
function flipBoard() { isFlipped = !isFlipped; clearSelection(); renderBoard(true); updateClockDisplay(); }

function updateMoveLog() {
  const log = document.getElementById('move-log'); log.innerHTML = '';
  for (let i = 0; i < fullMoveHistory.length; i += 2) {
    const row = document.createElement('div'); row.className = 'move-row';
    row.innerHTML = `<span class="move-number">${Math.floor(i/2)+1}.</span>
      <span class="move-text clickable-move ${i+1===currentMoveIndex?'active-move':''}" onclick="jumpToMoveIndex(${i+1})">${fullMoveHistory[i].san}</span>
      <span class="move-text clickable-move ${i+2===currentMoveIndex?'active-move':''}" onclick="jumpToMoveIndex(${i+2})">${fullMoveHistory[i+1]?fullMoveHistory[i+1].san:''}</span>`;
    log.appendChild(row);
  }
}

function jumpToMoveIndex(idx) {
  if (idx < 0 || idx > fullMoveHistory.length) return;
  game = new Chess(); for (let i = 0; i < idx; i++) game.move(fullMoveHistory[i]);
  currentMoveIndex = idx; clearSelection(); updateMoveLog(); updateStatus(); updateClockDisplay();
}

function renderPromotionChoices() {
  const container = document.querySelector('.promotion-choices'); container.innerHTML = '';
  ['q','r','b','n'].forEach(p => {
    const btn = document.createElement('button'); btn.className = 'promo-btn';
    btn.innerHTML = `<img src="${pieceImagePaths[game.turn()+p.toUpperCase()]}" class="piece">`;
    btn.onclick = () => {
      const res = game.move({ from: promotionFrom, to: promotionTo, promotion: p });
      fullMoveHistory.push({ from: res.from, to: res.to, promotion: res.promotion, san: res.san });
      currentMoveIndex = fullMoveHistory.length;
      document.getElementById('promotion-modal').classList.add('hidden');
      onMoveExecution();
    };
    container.appendChild(btn);
  });
}