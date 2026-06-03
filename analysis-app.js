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

let game = new Chess();
let selectedSquare = null;
let validMoves = [];
let isFlipped = false;

// СИСТЕМА ДЕРЕВА ХОДОВ
let moveHistoryTree = { id: "root", parent: null, move: null, children: [] };
let activeNode = moveHistoryTree;

// Управление перетаскиванием
let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;
let dragClone = null;
let draggedPieceImg = null;
let draggedSquare = null;

let stockfishWorker = null;
let isStockfishReady = false;
let recommendedAnalysisMove = null;
let promotionFrom = null;
let promotionTo = null;

document.addEventListener('DOMContentLoaded', () => {
  initStockfish();
  renderBoard(true);
  updateStatus();
  updateMoveLog();

  // Кнопки управления доской
  document.getElementById('btn-new-game').addEventListener('click', startNewGame);
  document.getElementById('btn-flip').addEventListener('click', flipBoard);
  document.getElementById('btn-nav-first').addEventListener('click', () => jumpToMoveNode(moveHistoryTree));
  document.getElementById('btn-nav-prev').addEventListener('click', navigatePrev);
  document.getElementById('btn-nav-next').addEventListener('click', navigateNext);
  document.getElementById('btn-nav-last').addEventListener('click', navigateLast);

  // Горячие клавиши
  document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') navigatePrev();
    if (e.key === 'ArrowRight') navigateNext();
  });

  // Переключатель ИИ (Вкл/Выкл)
  document.getElementById('engine-toggle').addEventListener('change', (e) => {
    if (!e.target.checked) {
      if (stockfishWorker) stockfishWorker.postMessage('stop');
      analysisLines = [];
      renderMultiPV();
      document.getElementById('analysis-engine-title-text').textContent = "ИИ остановлен";
    } else {
      runAnalysisTask();
    }
  });

  // Изменение количества линий и потоков на лету
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

let analysisLines = []; // Глобальный массив для хранения линий

function handleUCIResponse(message) {
  if (message === 'readyok') { isStockfishReady = true; runAnalysisTask(); return; }

  if (message.startsWith('info')) {
    // 1. Извлекаем глубину
    const dMatch = message.match(/depth (\d+)/);
    if (dMatch) document.getElementById('analysis-engine-title-text').textContent = `Глубина: ${dMatch[1]}`;

    // 2. Извлекаем номер линии (MultiPV)
    const multipvMatch = message.match(/multipv (\d+)/);
    const pvIndex = multipvMatch ? parseInt(multipvMatch[1]) - 1 : 0;

    // 3. Извлекаем оценку
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
      const mateMatch = message.match(/score mate (-?\d+)/);
      score = mateMatch ? "M" + Math.abs(parseInt(mateMatch[1])) : "M?";
      if (pvIndex === 0) document.getElementById('engine-eval-val').textContent = score;
    }

    // 4. Извлекаем цепочку ходов (PV)
    const pvMatch = message.match(/ pv (.+)/);
    if (pvMatch) {
      const pvMoves = pvMatch[1].split(' ');
      const bestMove = pvMoves[0];
      const continuation = pvMoves.slice(1, 5).join(' '); // Берем первые 4 хода продолжения

      // Сохраняем или обновляем линию в массиве
      analysisLines[pvIndex] = {
        score: score,
        move: bestMove.substring(0, 2) + " → " + bestMove.substring(2, 4),
        path: continuation
      };

      renderMultiPV(); // Вызываем отрисовку линий
    }
  }
}

function renderMultiPV() {
  const container = document.getElementById('multipv-container');
  if (!container) return;
  
  const isEnabled = document.getElementById('engine-toggle').checked;
  if (!isEnabled) {
    container.innerHTML = '<div style="color:#555; font-size:0.8rem; text-align:center; padding:10px; border: 1px dashed #444;">Движок выключен</div>';
    return;
  }

  container.innerHTML = '';
  analysisLines.forEach((line, index) => {
    if (!line) return;
    
    const lineEl = document.createElement('div');
    lineEl.className = 'pv-line';
    
    lineEl.innerHTML = `
      <div class="pv-score">${line.score}</div>
      <div class="pv-move">${line.move}</div>
      <div class="pv-path">${line.path}...</div>
    `;
    
    container.appendChild(lineEl);
  });
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
    sq.classList.remove('last-move', 'selected', 'check'); // Класс recommended удален из списка

    if (activeNode && activeNode.move && (name === activeNode.move.from || name === activeNode.move.to)) sq.classList.add('last-move');
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
  
  const piece = game.get(square);
  
  // Разрешаем "взять" любую фигуру на доске
  if (piece) {
    isDragging = true;
    draggedSquare = square;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    draggedPieceImg = e.target.classList.contains('piece') ? e.target : e.target.querySelector('.piece');

    // Если сейчас ход этой фигуры — показываем точки ходов
    if (piece.color === game.turn()) {
      selectedSquare = square;
      validMoves = game.moves({ square: square, verbose: true }).map(m => m.to);
    } else {
      // Если ход "чужой" — просто тащим фигуру без подсказок
      selectedSquare = null;
      validMoves = [];
    }

    renderBoard(false); // Перерисовываем (если ход чужой, точки исчезнут или не появятся)
    
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    try { e.target.setPointerCapture(e.pointerId); } catch(err) {}
  } 
  // Если кликнули по пустой клетке, когда уже выбрана фигура для легального хода
  else if (selectedSquare && validMoves.includes(square)) {
    attemptMove(selectedSquare, square);
  } else { 
    clearSelection(); 
  }
}

function handlePointerMove(e) {
  if (!isDragging || !draggedPieceImg) return;
  const dist = Math.hypot(e.clientX - dragStartX, e.clientY - dragStartY);
  if (dist > 5) {
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
  
  if (dragClone) { 
    document.body.removeChild(dragClone); 
    dragClone = null; 
  }
  
  if (draggedPieceImg) {
    draggedPieceImg.style.visibility = 'visible';
  }

  const el = document.elementFromPoint(e.clientX, e.clientY);
  const sqEl = el ? el.closest('.square') : null;
  const target = sqEl ? sqEl.dataset.square : null;

  // Если бросили на легальную клетку — ходим
  if (target && validMoves.includes(target)) {
    attemptMove(draggedSquare, target);
  } else {
    // В любом другом случае (нелегальный ход или "проба") просто возвращаем фигуру
    renderBoard(false);
  }
}

function attemptMove(from, to) {
  const move = game.moves({ square: from, verbose: true }).find(m => m.to === to);
  if (!move) return;
  if (move.flags.includes('p')) { 
    promotionFrom = from; 
    promotionTo = to; 
    document.getElementById('promotion-modal').classList.remove('hidden');
    renderPromotionChoices();
  } else {
    const res = game.move({ from, to });
    if (res) { 
      // ПРОИГРЫВАЕМ ЗВУК
      playMoveSound(res);
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
  selectedSquare = null; 
  validMoves = [];
  recommendedAnalysisMove = null; 
  renderBoard(true); 
  updateMoveLog(); 
  updateStatus(); 
  runAnalysisTask();
}

function jumpToMoveNode(node) {
  if (!node) return;
  activeNode = node;
  const path = [];
  let temp = node;
  while (temp && temp.move) { path.push(temp.move); temp = temp.parent; }
  game = new Chess();
  path.reverse().forEach(m => game.move(m));

  // Звук при перемотке (последний ход в цепочке)
  const lastMove = path[path.length - 1];
  if (lastMove) chessSounds.move.play();

  finalizeMove();
}

function updateMoveLog() {
  const log = document.getElementById('move-log');
  if (!log) return;
  log.innerHTML = '';
  const path = []; let temp = activeNode;
  while (temp && temp.move) { path.push(temp); temp = temp.parent; }
  path.reverse();
  for (let i = 0; i < path.length; i += 2) {
    const row = document.createElement('div'); row.className = 'move-row';
    const w = path[i]; const b = path[i+1];
    
    row.innerHTML = `<span class="move-number">${(i/2)+1}.</span>`;
    
    const wSpan = document.createElement('span');
    wSpan.className = `move-text clickable-move ${w === activeNode ? 'active-move' : ''}`;
    wSpan.textContent = w.move.san;
    wSpan.onclick = () => jumpToMoveNode(w);
    row.appendChild(wSpan);

    if (b) {
      const bSpan = document.createElement('span');
      bSpan.className = `move-text clickable-move ${b === activeNode ? 'active-move' : ''}`;
      bSpan.textContent = b.move.san;
      bSpan.onclick = () => jumpToMoveNode(b);
      row.appendChild(bSpan);
    }
    log.appendChild(row);
  }
  updateBranchSelector();
}

function updateBranchSelector() {
  const panel = document.getElementById('branch-panel');
  const container = document.getElementById('branch-choices');
  if (!panel || !container) return;

  const parent = activeNode.parent;
  if (parent && parent.children.length > 1) {
    panel.classList.remove('hidden-panel'); 
    container.innerHTML = '';
    parent.children.forEach(c => {
      const btn = document.createElement('button'); 
      btn.className = `btn btn-secondary branch-btn ${c === activeNode ? 'active-branch' : ''}`;
      btn.textContent = c.move.san; 
      btn.onclick = () => jumpToMoveNode(c);
      container.appendChild(btn);
    });
  } else panel.classList.add('hidden-panel');
}

function renderPromotionChoices() {
  const container = document.querySelector('.promotion-choices');
  container.innerHTML = '';
  ['q','r','b','n'].forEach(p => {
    const btn = document.createElement('button'); btn.className = 'promo-btn';
    btn.innerHTML = `<img src="${pieceImagePaths[game.turn()+p.toUpperCase()]}" class="piece">`;
    btn.onclick = () => {
      const res = game.move({ from: promotionFrom, to: promotionTo, promotion: p });
      recordMoveInTree(res);
      document.getElementById('promotion-modal').classList.add('hidden');
      finalizeMove();
    };
    container.appendChild(btn);
  });
}

function navigatePrev() { if (activeNode.parent) jumpToMoveNode(activeNode.parent); }
function navigateNext() { if (activeNode.children.length > 0) jumpToMoveNode(activeNode.children[0]); }
function navigateLast() { let t = activeNode; while(t.children.length > 0) t = t.children[0]; jumpToMoveNode(t); }

function startNewGame() {
  game = new Chess(); 
  moveHistoryTree = { id:"root", parent:null, move:null, children:[] };
  activeNode = moveHistoryTree; 
  finalizeMove();
}

function flipBoard() { isFlipped = !isFlipped; renderBoard(true); }
function clearSelection() { selectedSquare = null; validMoves = []; renderBoard(false); }

function updateStatus() {
  const s = document.getElementById('status-text');
  if (game.in_checkmate()) s.textContent = "Мат!";
  else if (game.in_draw()) s.textContent = "Ничья";
  else s.textContent = "Свободный анализ";
}

function runAnalysisTask() {
  if (!isStockfishReady || !stockfishWorker) return;

  const isEnabled = document.getElementById('engine-toggle').checked;
  if (!isEnabled) return; 

  const multiPV = document.getElementById('select-multipv').value;
  const threads = document.getElementById('select-threads').value;

  // Останавливаем текущий расчет
  stockfishWorker.postMessage('stop');

  // Очищаем старые данные
  analysisLines = [];
  const container = document.getElementById('multipv-container');
  if (container) container.innerHTML = '<div style="color:#666; font-size:0.8rem;">Анализирую...</div>';

  // Применяем настройки и запускаем
  stockfishWorker.postMessage(`setoption name MultiPV value ${multiPV}`);
  stockfishWorker.postMessage(`setoption name Threads value ${threads}`);
  stockfishWorker.postMessage(`setoption name Hash value 256`);
  stockfishWorker.postMessage(`position fen ${game.fen()}`);
  stockfishWorker.postMessage('go depth 18');
}

function updateEvaluationBar(cp) {
  const fill = document.getElementById('eval-fill');
  const text = document.getElementById('eval-text');
  let p = 50 + (Math.max(-800, Math.min(800, cp)) / 800) * 45;
  if (fill) fill.style.height = `${p}%`;
  if (text) text.textContent = (cp / 100).toFixed(1);
}