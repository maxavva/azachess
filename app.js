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

var liveGame = new Chess();
var displayGame = new Chess();
let fullMoveHistory = [], currentMoveIndex = 0; 
let whiteTime = 300, blackTime = 300, increment = 3, isClockEnabled = true, isGameStarted = false, timerInterval = null;
let isFlipped = false, isDragging = false, dragStartX = 0, dragStartY = 0, dragClone = null, draggedPieceImg = null, draggedSquare = null;
let stockfishWorker = null, isStockfishReady = false, isWaitingForAIMove = false;

document.addEventListener('DOMContentLoaded', () => {
  initStockfish();
  
  const bind = (id, fn) => { const el = document.getElementById(id); if (el) el.onclick = fn; };
  bind('btn-new-game', startNewGame);
  bind('btn-flip', flipBoard);
  bind('btn-nav-first', () => jumpToMoveIndex(0));
  bind('btn-nav-prev', () => jumpToMoveIndex(currentMoveIndex - 1));
  bind('btn-nav-next', () => jumpToMoveIndex(currentMoveIndex + 1));
  bind('btn-nav-last', () => jumpToMoveIndex(fullMoveHistory.length));

  // ИСПРАВЛЕНИЕ: Стрелочки
  document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') jumpToMoveIndex(currentMoveIndex - 1);
    if (e.key === 'ArrowRight') jumpToMoveIndex(currentMoveIndex + 1);
  });

  resetGameSettings();
});

function initStockfish() {
  const blobCode = `importScripts('https://cdnjs.cloudflare.com/ajax/libs/stockfish.js/10.0.2/stockfish.js');`;
  stockfishWorker = new Worker(URL.createObjectURL(new Blob([blobCode], { type: 'application/javascript' })));
  stockfishWorker.onmessage = (e) => {
    if (e.data === 'readyok') { isStockfishReady = true; checkAndTriggerAI(); }
    if (e.data.startsWith('bestmove') && isWaitingForAIMove) {
      isWaitingForAIMove = false;
      const move = e.data.split(' ')[1];
      if (move && move !== '(none)') {
        const res = liveGame.move({ from: move.substring(0,2), to: move.substring(2,4), promotion: move[4]||'q' });
        if (res) {
          if (window.playMoveSound) playMoveSound(res);
          fullMoveHistory.push(res);
          if (currentMoveIndex === fullMoveHistory.length - 1) currentMoveIndex = fullMoveHistory.length;
          syncDisplayGame(); onMoveExecution();
        }
      }
    }
  };
  stockfishWorker.postMessage('uci'); stockfishWorker.postMessage('isready');
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
    const name = sq.dataset.square, piece = displayGame.get(name);
    sq.classList.remove('last-move', 'selected', 'check');
    const last = fullMoveHistory[currentMoveIndex - 1];
    if (last && (name === last.from || name === last.to)) sq.classList.add('last-move');
    if (displayGame.in_check() && piece && piece.type === 'k' && piece.color === displayGame.turn()) sq.classList.add('check');
    let img = sq.querySelector('.piece');
    if (piece) {
      const src = pieceImagePaths[`${piece.color}${piece.type.toUpperCase()}`];
      if (!img) { img = document.createElement('img'); img.className = 'piece'; img.draggable = false; sq.appendChild(img); }
      img.src = src;
    } else if (img) sq.removeChild(img);
  });
}

function handlePointerDown(e, sq) {
  if (typeof unlockAudio === 'function') unlockAudio();
  if (currentMoveIndex < fullMoveHistory.length || isWaitingForAIMove || liveGame.game_over()) return;
  const piece = liveGame.get(sq);
  if (piece && piece.color === (isFlipped ? 'b' : 'w')) {
    isDragging = true; draggedSquare = sq; dragStartX = e.clientX; dragStartY = e.clientY;
    draggedPieceImg = e.target.classList.contains('piece') ? e.target : e.target.querySelector('.piece');
    window.onpointermove = handlePointerMove; window.onpointerup = handlePointerUp;
    try { e.target.setPointerCapture(e.pointerId); } catch(err) {}
  }
}

function handlePointerMove(e) {
  if (!isDragging || !draggedPieceImg) return;
  if (Math.hypot(e.clientX - dragStartX, e.clientY - dragStartY) > 5) {
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
  isDragging = false; window.onpointermove = null; window.onpointerup = null;
  if (dragClone) { document.body.removeChild(dragClone); dragClone = null; }
  if (draggedPieceImg) draggedPieceImg.style.visibility = 'visible';
  const el = document.elementFromPoint(e.clientX, e.clientY);
  const target = el?.closest('.square')?.dataset.square;
  if (target) {
    const res = liveGame.move({ from: draggedSquare, to: target, promotion: 'q' });
    if (res) {
      if (window.playMoveSound) playMoveSound(res);
      fullMoveHistory.push(res); currentMoveIndex = fullMoveHistory.length;
      syncDisplayGame(); onMoveExecution();
    }
  }
}

function onMoveExecution() {
  if (!isGameStarted) isGameStarted = true;
  if (isClockEnabled) { if (liveGame.turn() === 'b') whiteTime += increment; else blackTime += increment; }
  updateMoveLog(); updateStatus(); updateClockDisplay();
  if (!liveGame.game_over()) { if (isClockEnabled) startTimer(); checkAndTriggerAI(); }
  else stopTimer();
}

function syncDisplayGame() {
  displayGame = new Chess();
  fullMoveHistory.slice(0, currentMoveIndex).forEach(m => displayGame.move(m));
  renderBoard(false);
}

function jumpToMoveIndex(idx) {
  if (idx < 0 || idx > fullMoveHistory.length) return;
  currentMoveIndex = idx; syncDisplayGame(); updateMoveLog();
}

function startTimer() {
  stopTimer(); if (!isClockEnabled || !isGameStarted) return;
  timerInterval = setInterval(() => {
    if (liveGame.turn() === 'w') whiteTime--; else blackTime--;
    if (whiteTime <= 0 || blackTime <= 0) {
      whiteTime = Math.max(0, whiteTime); blackTime = Math.max(0, blackTime);
      stopTimer(); updateStatus();
      if (window.chessSounds) chessSounds.gameEnd.play();
    }
    updateClockDisplay();
  }, 1000);
}

function updateClockDisplay() {
  const t = document.getElementById('clock-top'), b = document.getElementById('clock-bottom');
  if (!t || !b) return;
  const format = (s) => `${Math.floor(s/60)}:${(s%60).toString().padStart(2, '0')}`;
  (isFlipped ? t : b).textContent = format(whiteTime);
  (isFlipped ? b : t).textContent = format(blackTime);
  
  // ИСПРАВЛЕНИЕ: Часы всегда по liveGame
  const turn = liveGame.turn();
  const active = isGameStarted && !liveGame.game_over() && whiteTime > 0 && blackTime > 0;
  t.classList.toggle('active', active && ((isFlipped && turn === 'w') || (!isFlipped && turn === 'b')));
  b.classList.toggle('active', active && ((!isFlipped && turn === 'w') || (isFlipped && turn === 'b')));
}

function resetGameSettings() {
  stopTimer(); liveGame = new Chess(); displayGame = new Chess(); fullMoveHistory = []; currentMoveIndex = 0; isGameStarted = false;
  const timeVal = localStorage.getItem('selected-time-control') || '5+3';
  if (timeVal === 'none') { isClockEnabled = false; document.getElementById('clocks-wrapper').style.display = 'none'; }
  else {
    isClockEnabled = true; document.getElementById('clocks-wrapper').style.display = 'flex';
    const parts = timeVal.split('+');
    whiteTime = parseInt(parts[0]) * 60; blackTime = whiteTime; increment = parseInt(parts[1]) || 0;
  }
  updateClockDisplay(); updateMoveLog(); updateStatus(); renderBoard(true); checkAndTriggerAI();
}

function stopTimer() { if (timerInterval) clearInterval(timerInterval); timerInterval = null; }
function updateStatus() {
  const s = document.getElementById('status-text'); if (!s) return;
  if (isClockEnabled && isGameStarted && whiteTime <= 0) s.textContent = 'Белые: время вышло!';
  else if (isClockEnabled && isGameStarted && blackTime <= 0) s.textContent = 'Черные: время вышло!';
  else if (liveGame.in_checkmate()) s.textContent = 'Мат!';
  else s.textContent = liveGame.turn()==='w' ? 'Ход белых' : 'Ход черных';
}
function checkAndTriggerAI() {
  const pc = isFlipped ? 'b' : 'w';
  if (liveGame.turn() !== pc && !liveGame.game_over()) triggerEngineMove();
}
function triggerEngineMove() {
  if (!isStockfishReady || isWaitingForAIMove) return;
  const lv = localStorage.getItem('selected-ai-level') || 3;
  const cfg = AI_LEVELS[lv]; isWaitingForAIMove = true;
  stockfishWorker.postMessage(`setoption name Skill Level value ${cfg.skill}`);
  stockfishWorker.postMessage(`position fen ${liveGame.fen()}`);
  stockfishWorker.postMessage(`go depth ${cfg.depth}`);
}
function flipBoard() { isFlipped = !isFlipped; renderBoard(true); updateClockDisplay(); checkAndTriggerAI(); }
function startNewGame() { resetGameSettings(); }
function updateMoveLog() {
  const log = document.getElementById('move-log'); if(!log) return; log.innerHTML = '';
  for (let i = 0; i < fullMoveHistory.length; i += 2) {
    const row = document.createElement('div'); row.className = 'move-row';
    row.innerHTML = `<span style="color:#666;width:25px;display:inline-block;">${(i/2)+1}.</span>
      <span class="move-text ${i+1===currentMoveIndex?'active-move':''}" style="cursor:pointer;padding:0 5px;" onclick="jumpToMoveIndex(${i+1})">${fullMoveHistory[i].san}</span>
      ${fullMoveHistory[i+1] ? `<span class="move-text ${i+2===currentMoveIndex?'active-move':''}" style="cursor:pointer;padding:0 5px;" onclick="jumpToMoveIndex(${i+2})">${fullMoveHistory[i+1].san}</span>` : ''}`;
    log.appendChild(row);
  }
}
