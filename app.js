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
    1:{skill:0,depth:1}, 2:{skill:3,depth:2}, 3:{skill:6,depth:4}, 4:{skill:10,depth:6}, 
    5:{skill:14,depth:8}, 6:{skill:17,depth:12}, 7:{skill:20,depth:15}, 8:{skill:20,depth:20} 
};

// СОСТОЯНИЕ ИГРЫ
var liveGame = new Chess();
var displayGame = new Chess();
window.game = liveGame;

let gameStartTime = null; // Метка времени начала самого первого хода
let whiteTime = 0, blackTime = 0;

let fullMoveHistory = [], currentMoveIndex = 0;
let whiteTime = 300, blackTime = 300, increment = 3, isClockEnabled = true, isGameStarted = false, timerInterval = null;

// ПЕРЕМЕННЫЕ ПОВОРОТА И ЦВЕТА
let isFlipped = false;   // Отвечает только за картинку (кто внизу экрана)
let userColor = 'w';    // Отвечает за логику (каким цветом играет человек)

let isDragging = false, dragStartX = 0, dragStartY = 0, dragClone = null, draggedPieceImg = null, draggedSquare = null, dragMovedEnough = false;
let selectedSquare = null, validMoves = [];
let stockfishWorker = null, isStockfishReady = false, isWaitingForAIMove = false;
let promotionFrom = null, promotionTo = null;
const DRAG_THRESHOLD = 10;

function saveGameState() {
    const state = {
        fen: liveGame.fen(),
        history: fullMoveHistory,
        currentIdx: currentMoveIndex,
        whiteTime: whiteTime,
        blackTime: blackTime,
        isGameStarted: isGameStarted,
        userColor: userColor,
        isFlipped: isFlipped,
        isClockEnabled: isClockEnabled,
        increment: increment
    };
    localStorage.setItem('azachess-save-game', JSON.stringify(state));
}

function initApp() {
    if (typeof Chess === 'undefined') { setTimeout(initApp, 100); return; }
    initStockfish();
    
    const bind = (id, fn) => { const el = document.getElementById(id); if (el) el.onclick = fn; };
    bind('btn-new-game', startNewGame);
    bind('btn-flip', flipBoard);
    bind('btn-nav-first', () => jumpToMoveIndex(0));
    bind('btn-nav-prev', () => jumpToMoveIndex(currentMoveIndex - 1));
    bind('btn-nav-next', () => jumpToMoveIndex(currentMoveIndex + 1));
    bind('btn-nav-last', () => jumpToMoveIndex(fullMoveHistory.length));

    document.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowLeft') jumpToMoveIndex(currentMoveIndex - 1);
        if (e.key === 'ArrowRight') jumpToMoveIndex(currentMoveIndex + 1);
    });
    
    resetGameSettings();
}
document.addEventListener('DOMContentLoaded', initApp);

function initStockfish() {
    try {
        const workerCode = `importScripts('https://cdnjs.cloudflare.com/ajax/libs/stockfish.js/10.0.2/stockfish.js');`;
        const blob = new Blob([workerCode], { type: 'application/javascript' });
        stockfishWorker = new Worker(URL.createObjectURL(blob));
        
        stockfishWorker.onmessage = (e) => {
            if (e.data === 'readyok') {
                isStockfishReady = true;
                checkAndTriggerAI();
            }
            if (e.data.startsWith('bestmove') && isWaitingForAIMove) {
                isWaitingForAIMove = false;
                const move = e.data.split(' ')[1];
                if (move && move !== '(none)') {
                    const res = liveGame.move({ from: move.substring(0, 2), to: move.substring(2, 4), promotion: move[4] || 'q' });
                    if (res) {
                        if (window.playMoveSound) playMoveSound(res);
                        fullMoveHistory.push(res);
                        if (currentMoveIndex === fullMoveHistory.length - 1) currentMoveIndex = fullMoveHistory.length;
                        syncDisplayGame(); 
                        onMoveExecution();
                    }
                }
            }
        };
        stockfishWorker.postMessage('uci');
        stockfishWorker.postMessage('isready');
    } catch (err) { console.error("Ошибка ИИ:", err); }
}

function renderBoard(rebuild = false) {
    const boardEl = document.getElementById('board');
    if (!boardEl) return;
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
        if (selectedSquare === name) sq.classList.add('selected');
        if (displayGame.in_check() && piece && piece.type === 'k' && piece.color === displayGame.turn()) sq.classList.add('check');
        
        let img = sq.querySelector('.piece');
        if (piece) {
            const src = pieceImagePaths[`${piece.color}${piece.type.toUpperCase()}`];
            if (!img) { img = document.createElement('img'); img.className = 'piece'; img.draggable = false; sq.appendChild(img); }
            img.src = src;
        } else if (img) sq.removeChild(img);
        
        let m = sq.querySelector('.move-dest, .move-dest-capture');
        if (currentMoveIndex === fullMoveHistory.length && validMoves.includes(name)) {
            const cls = piece ? 'move-dest-capture' : 'move-dest';
            if (!m || m.className !== cls) { if (m) sq.removeChild(m); m = document.createElement('div'); m.className = cls; sq.appendChild(m); }
        } else if (m) sq.removeChild(m);
    });
}

function handlePointerDown(e, sq) {
    if (typeof unlockAudio === 'function') unlockAudio();
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (liveGame.game_over() || isWaitingForAIMove) return;
    
    if (selectedSquare && validMoves.includes(sq)) {
        handleMoveAttempt(selectedSquare, sq);
        return;
    }

    if (currentMoveIndex < fullMoveHistory.length) return;

    const piece = liveGame.get(sq);
    
    // ИСПРАВЛЕНО: Проверяем цвет игрока (userColor) и чей сейчас ход
    if (piece && piece.color === userColor && piece.color === liveGame.turn()) {
        isDragging = true; dragMovedEnough = false; draggedSquare = sq;
        dragStartX = e.clientX; dragStartY = e.clientY;
        draggedPieceImg = e.target.classList.contains('piece') ? e.target : e.target.querySelector('.piece');
        selectedSquare = sq; validMoves = liveGame.moves({ square: sq, verbose: true }).map(m => m.to);
        renderBoard(false);
        window.onpointermove = handlePointerMove; window.onpointerup = handlePointerUp;
    } else {
        clearSelection();
    }
}

function handlePointerMove(e) {
    if (!isDragging || !draggedPieceImg) return;
    if (Math.hypot(e.clientX - dragStartX, e.clientY - dragStartY) > DRAG_THRESHOLD) {
        dragMovedEnough = true;
        if (!dragClone) {
            dragClone = draggedPieceImg.cloneNode(true);
            dragClone.className = 'piece drag-clone';
            const rect = draggedPieceImg.getBoundingClientRect();
            dragClone.style.width = rect.width + 'px';
            dragClone.style.height = rect.height + 'px';
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
    if (dragMovedEnough && target && validMoves.includes(target)) handleMoveAttempt(draggedSquare, target);
    else if (dragMovedEnough) renderBoard(false);
}

function handleMoveAttempt(from, to) {
    const move = liveGame.moves({ square: from, verbose: true }).find(m => m.to === to);
    if (move && move.flags.includes('p')) {
        promotionFrom = from; promotionTo = to;
        document.getElementById('promotion-modal').classList.remove('hidden');
        renderPromotionChoices();
    } else {
        executeMove(from, to);
    }
}

function executeMove(from, to, promo = 'q') {
    const res = liveGame.move({ from, to, promotion: promo });
    if (res) {
        if (window.playMoveSound) playMoveSound(res);
        
        // Фиксируем время хода
        res.timestamp = Date.now(); 
        
        // Если это вообще самый первый ход в партии (любой стороны)
        if (fullMoveHistory.length === 0) {
            gameStartTime = Date.now(); 
        }

        fullMoveHistory.push(res); 
        currentMoveIndex = fullMoveHistory.length;
        syncDisplayGame(); 
        onMoveExecution();
    } else clearSelection();
}

function renderPromotionChoices() {
    const container = document.querySelector('.promotion-choices');
    const turn = liveGame.turn(); container.innerHTML = '';
    ['q','r','b','n'].forEach(p => {
        const btn = document.createElement('button'); btn.className = 'promo-btn';
        btn.innerHTML = `<img src="${pieceImagePaths[turn+p.toUpperCase()]}" style="width:100%">`;
        btn.onclick = () => { executeMove(promotionFrom, promotionTo, p); document.getElementById('promotion-modal').classList.add('hidden'); };
        container.appendChild(btn);
    });
}

function onMoveExecution() {
    if (!isGameStarted) isGameStarted = true;
    if (isClockEnabled) { 
        if (liveGame.turn() === 'b') whiteTime += increment; 
        else blackTime += increment; 
    }
    selectedSquare = null; 
    validMoves = [];
    
    updateMoveLog(); 
    updateStatus(); 
    updateClockDisplay(); 
    renderBoard(false);
    
    // СОХРАНЕНИЕ
    saveGameState();

    if (!liveGame.game_over()) { 
        if (isClockEnabled) startTimer(); 
        checkAndTriggerAI(); 
    } else {
        stopTimer();
    }
}

function syncDisplayGame() {
    displayGame = new Chess();
    fullMoveHistory.slice(0, currentMoveIndex).forEach(m => displayGame.move(m));
    renderBoard(false);
}

function jumpToMoveIndex(idx) {
    if (idx < 0 || idx > fullMoveHistory.length) return;
    currentMoveIndex = idx; selectedSquare = null; validMoves = [];
    syncDisplayGame(); updateMoveLog();
}

function startTimer() {
    stopTimer();
    if (!isClockEnabled || liveGame.game_over()) return;

    timerInterval = setInterval(() => {
        const times = calculateRemainingTimes();
        whiteTime = times.white;
        blackTime = times.black;

        if (whiteTime <= 0 || blackTime <= 0) {
            stopTimer();
            updateStatus();
        }
        updateClockDisplay();
        // Сохраняем каждую секунду, чтобы история была актуальной
        saveGameState(); 
    }, 1000);
}

function saveGameState() {
    const state = {
        fen: liveGame.fen(),
        history: fullMoveHistory,
        currentIdx: currentMoveIndex,
        gameStartTime: gameStartTime, // Обязательно сохраняем точку отсчета
        isGameStarted: isGameStarted,
        userColor: userColor,
        isFlipped: isFlipped,
        isClockEnabled: isClockEnabled,
        increment: increment
    };
    localStorage.setItem('azachess-save-game', JSON.stringify(state));
}

function stopTimer() { if (timerInterval) clearInterval(timerInterval); timerInterval = null; }

function updateClockDisplay() {
    const t = document.getElementById('clock-top'), b = document.getElementById('clock-bottom');
    if (!t || !b || !isClockEnabled) return;
    const format = (s) => `${Math.floor(s/60)}:${(s%60).toString().padStart(2, '0')}`;
    
    // Часы всегда показывают: нижние - игрока, верхние - противника
    (isFlipped ? t : b).textContent = format(whiteTime);
    (isFlipped ? b : t).textContent = format(blackTime);
    
    const turn = liveGame.turn();
    const active = isGameStarted && !liveGame.game_over() && whiteTime > 0 && blackTime > 0;
    t.classList.toggle('active', active && ((isFlipped && turn === 'w') || (!isFlipped && turn === 'b')));
    b.classList.toggle('active', active && ((!isFlipped && turn === 'w') || (isFlipped && turn === 'b')));
}

function resetGameSettings() {
    stopTimer();
    const savedData = localStorage.getItem('azachess-save-game');
    
    if (savedData) {
        const state = JSON.parse(savedData);
        liveGame = new Chess(state.fen);
        fullMoveHistory = state.history;
        // Загружаем индекс хода и фиксируем его как текущий
        currentMoveIndex = state.currentIdx || fullMoveHistory.length; 
        gameStartTime = state.gameStartTime;
        isGameStarted = state.isGameStarted;
        userColor = state.userColor;
        isFlipped = state.isFlipped;
        isClockEnabled = state.isClockEnabled;
        increment = state.increment;

        // ВАЖНО: Синхронизируем видимую доску с последним ходом из истории
        displayGame = new Chess();
        for (let i = 0; i < currentMoveIndex; i++) {
            displayGame.move(fullMoveHistory[i]);
        }
        console.log("Партия восстановлена на ходу:", currentMoveIndex);
    } else {
        // НОВАЯ ИГРА
        liveGame = new Chess();
        displayGame = new Chess();
        fullMoveHistory = [];
        currentMoveIndex = 0;
        isGameStarted = true;
        gameStartTime = Date.now();

        let chosenColor = localStorage.getItem('selected-player-color') || 'w';
        if (chosenColor === 'random') chosenColor = Math.random() > 0.5 ? 'w' : 'b';
        userColor = chosenColor;
        isFlipped = (userColor === 'b');

        const timeVal = localStorage.getItem('selected-time-control') || '5+3';
        const parts = timeVal.split('+');
        isClockEnabled = timeVal !== 'none';
        increment = parseInt(parts[1]) || 0;
    }

    // UI элементы
    const cw = document.getElementById('clocks-wrapper');
    if (cw) cw.style.display = isClockEnabled ? 'flex' : 'none';

    // Обновляем время ПЕРЕД отрисовкой
    refreshClocks(); 

    updateMoveLog();
    updateStatus();
    renderBoard(true); // Рисуем доску
    
    // Если игра запущена и не закончена - запускаем таймер
    if (isClockEnabled && !liveGame.game_over()) {
        startTimer();
    }
    
    checkAndTriggerAI();
    saveGameState();
}

// Вспомогательная функция для обновления цифр на часах
function refreshClocks() {
    const times = calculateRemainingTimes();
    whiteTime = times.white;
    blackTime = times.black;
    updateClockDisplay();
}

function startTimer() {
    stopTimer();
    if (!isClockEnabled || liveGame.game_over()) return;

    // Сразу обновляем при запуске
    refreshClocks();

    timerInterval = setInterval(() => {
        refreshClocks();
        
        if (whiteTime <= 0 || blackTime <= 0) {
            stopTimer();
            updateStatus();
        }
        // Сохраняем состояние каждую секунду, чтобы метки времени были актуальны
        saveGameState(); 
    }, 1000);
}
function updateStatus() {
    const s = document.getElementById('status-text'); if (!s) return;
    if (isClockEnabled && whiteTime <= 0) s.textContent = 'Белые: время вышло!';
    else if (isClockEnabled && blackTime <= 0) s.textContent = 'Черные: время вышло!';
    else if (liveGame.in_checkmate()) s.textContent = 'Мат!';
    else s.textContent = liveGame.turn()==='w' ? 'Ход белых' : 'Ход черных';
}

function checkAndTriggerAI() {
    // ИСПРАВЛЕНО: ИИ ходит, если сейчас НЕ ход игрока
    if (liveGame.turn() !== userColor && !liveGame.game_over()) triggerEngineMove();
}

function triggerEngineMove() {
    if (!isStockfishReady || isWaitingForAIMove) return;
    const lv = localStorage.getItem('selected-ai-level') || 3;
    isWaitingForAIMove = true;
    stockfishWorker.postMessage(`setoption name Skill Level value ${AI_LEVELS[lv].skill}`);
    stockfishWorker.postMessage(`position fen ${liveGame.fen()}`);
    stockfishWorker.postMessage(`go depth ${AI_LEVELS[lv].depth}`);
}

function startNewGame() {
    if (confirm("Вы уверены, что хотите начать новую игру? Текущий прогресс будет удален.")) {
        localStorage.removeItem('azachess-save-game'); // Удаляем сохранение
        resetGameSettings(); // Запускаем создание чистой игры
    }
}
function clearSelection() { selectedSquare = null; validMoves = []; renderBoard(false); }

function flipBoard() { 
    isFlipped = !isFlipped; 
    renderBoard(true); 
    updateClockDisplay(); 
}

function updateMoveLog() {
    const log = document.getElementById('move-log'); if(!log) return; log.innerHTML = '';
    for (let i = 0; i < fullMoveHistory.length; i += 2) {
        const row = document.createElement('div'); row.className = 'move-row';
        row.innerHTML = `<span style="color:#666;width:25px;display:inline-block;">${(i/2)+1}.</span>
        <span class="move-text ${i+1===currentMoveIndex?'active-move':''}" onclick="jumpToMoveIndex(${i+1})">${fullMoveHistory[i].san}</span>
        ${fullMoveHistory[i+1] ? `<span class="move-text ${i+2===currentMoveIndex?'active-move':''}" onclick="jumpToMoveIndex(${i+2})">${fullMoveHistory[i+1].san}</span>` : ''}`;
        log.appendChild(row);
    }
}

function calculateRemainingTimes() {
    const timeVal = localStorage.getItem('selected-time-control') || '5+3';
    const parts = timeVal.split('+');
    const totalStartSeconds = (parseInt(parts[0]) || 5) * 60;
    const inc = parseInt(parts[1]) || 0;

    if (!gameStartTime) return { white: totalStartSeconds, black: totalStartSeconds };

    let usedWhite = 0;
    let usedBlack = 0;
    const now = Date.now();

    // Считаем время прошлых ходов
    for (let i = 0; i < fullMoveHistory.length; i++) {
        const moveTime = fullMoveHistory[i].timestamp;
        const startTime = (i === 0) ? gameStartTime : fullMoveHistory[i - 1].timestamp;
        const duration = Math.floor((moveTime - startTime) / 1000);

        if (i % 2 === 0) usedWhite += duration; 
        else usedBlack += duration;
    }

    // Считаем текущее время (кто сейчас думает)
    if (!liveGame.game_over()) {
        const lastEventTime = (fullMoveHistory.length === 0) ? gameStartTime : fullMoveHistory[fullMoveHistory.length - 1].timestamp;
        const thinkingTime = Math.floor((now - lastEventTime) / 1000);

        if (liveGame.turn() === 'w') usedWhite += thinkingTime;
        else usedBlack += thinkingTime;
    }

    // Добавляем бонусы за завершенные ходы
    const whiteBonus = Math.floor((fullMoveHistory.length + 1) / 2) * inc;
    const blackBonus = Math.floor(fullMoveHistory.length / 2) * inc;

    return {
        white: Math.max(0, totalStartSeconds + whiteBonus - usedWhite),
        black: Math.max(0, totalStartSeconds + blackBonus - usedBlack)
    };
}
