//? Проверка нейросети CodeRabbit

/**
 * AZACHESS - Официальный скрипт игрового режима
 * Содержит: Движок Stockfish, Систему "Живого времени", Сохранение состояния.
 */

// 1. КОНСТАНТЫ
const PIECE_IMAGES = {
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

// 2. СОСТОЯНИЕ ИГРЫ
var liveGame = new Chess();
var displayGame = new Chess();
window.game = liveGame; // Для доступа из sounds.js

let fullMoveHistory = [], currentMoveIndex = 0;
let whiteTime = 300, blackTime = 300, increment = 0, lastTick = null;
let isClockEnabled = true, isGameStarted = false, timerInterval = null;
let isFlipped = false, userColor = 'w';

let selectedSquare = null, validMoves = [];
let isDragging = false, dragStartX = 0, dragStartY = 0, dragClone = null, draggedPieceImg = null, draggedSquare = null, dragMovedEnough = false;
let stockfishWorker = null, isStockfishReady = false, isWaitingForAIMove = false;
let promotionFrom = null, promotionTo = null;
const DRAG_THRESHOLD = 10;

// 3. ИНИЦИАЛИЗАЦИЯ
document.addEventListener('DOMContentLoaded', () => {
    initApp();
});

function initApp() {
    if (typeof Chess === 'undefined') { setTimeout(initApp, 100); return; }

    // Навигация
    const setupBtn = (id, fn) => { const el = document.getElementById(id); if (el) el.onclick = fn; };
    setupBtn('btn-new-game', startNewGame);
    setupBtn('btn-flip', flipBoard);
    setupBtn('btn-nav-first', () => jumpToMoveIndex(0));
    setupBtn('btn-nav-prev', () => jumpToMoveIndex(currentMoveIndex - 1));
    setupBtn('btn-nav-next', () => jumpToMoveIndex(currentMoveIndex + 1));
    setupBtn('btn-nav-last', () => jumpToMoveIndex(fullMoveHistory.length));

    // Слушатель клавиш
    window.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowLeft') { e.preventDefault(); jumpToMoveIndex(currentMoveIndex - 1); }
        if (e.key === 'ArrowRight') { e.preventDefault(); jumpToMoveIndex(currentMoveIndex + 1); }
    });

    initStockfish();
    resetGameSettings();
}

// 4. ДВИЖОК
function initStockfish() {
    try {
        const blobCode = `importScripts('https://cdnjs.cloudflare.com/ajax/libs/stockfish.js/10.0.2/stockfish.js');`;
        const blob = new Blob([blobCode], { type: 'application/javascript' });
        stockfishWorker = new Worker(URL.createObjectURL(blob));
        
        stockfishWorker.onmessage = (e) => {
            if (e.data === 'readyok') { isStockfishReady = true; checkAndTriggerAI(); }
            if (e.data.startsWith('bestmove') && isWaitingForAIMove) {
                isWaitingForAIMove = false;
                const move = e.data.split(' ')[1];
                if (move && move !== '(none)') {
                    executeMove(move.substring(0, 2), move.substring(2, 4), move[4] || 'q');
                }
            }
        };
        stockfishWorker.postMessage('uci');
        stockfishWorker.postMessage('isready');
    } catch (err) { console.error("Stockfish Error:", err); }
}

// 5. ЛОГИКА ДОСКИ И ХОДОВ
function renderBoard(rebuild = false) {
    const boardEl = document.getElementById('board');
    if (!boardEl) return;

    if (rebuild) {
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
        if (displayGame.in_check() && piece?.type === 'k' && piece.color === displayGame.turn()) sq.classList.add('check');

        let img = sq.querySelector('.piece');
        if (piece) {
            if (!img) { img = document.createElement('img'); img.className = 'piece'; img.draggable = false; sq.appendChild(img); }
            img.src = PIECE_IMAGES[`${piece.color}${piece.type.toUpperCase()}`];
        } else if (img) sq.removeChild(img);

        const m = sq.querySelector('.move-dest, .move-dest-capture');
        if (m) sq.removeChild(m);

        if (currentMoveIndex === fullMoveHistory.length && validMoves.includes(name)) {
            const dest = document.createElement('div');
            dest.className = piece ? 'move-dest-capture' : 'move-dest';
            sq.appendChild(dest);
        }
    });
}

function handlePointerDown(e, sq) {
    if (typeof unlockAudio === 'function') unlockAudio();
    
    // БЛОКИРОВКА ПРИ КОНЦЕ ВРЕМЕНИ
    const isTimeOut = isClockEnabled && (whiteTime <= 0 || blackTime <= 0);
    if (liveGame.game_over() || isWaitingForAIMove || currentMoveIndex < fullMoveHistory.length || isTimeOut) return;

    if (selectedSquare && validMoves.includes(sq)) {
        handleMoveAttempt(selectedSquare, sq);
        return;
    }

    const piece = liveGame.get(sq);
    if (piece && piece.color === userColor && piece.color === liveGame.turn()) {
        isDragging = true; dragMovedEnough = false; draggedSquare = sq;
        dragStartX = e.clientX; dragStartY = e.clientY;
        draggedPieceImg = e.target.classList.contains('piece') ? e.target : e.target.querySelector('.piece');
        selectedSquare = sq; validMoves = liveGame.moves({ square: sq, verbose: true }).map(m => m.to);
        renderBoard(false);
        window.onpointermove = handlePointerMove; window.onpointerup = handlePointerUp;
    } else clearSelection();
}

function handlePointerMove(e) {
    if (!isDragging || !draggedPieceImg) return;
    if (Math.hypot(e.clientX - dragStartX, e.clientY - dragStartY) > DRAG_THRESHOLD) {
        dragMovedEnough = true;
        if (!dragClone) {
            dragClone = draggedPieceImg.cloneNode(true);
            dragClone.className = 'piece drag-clone';
            const rect = draggedPieceImg.getBoundingClientRect();
            dragClone.style.width = rect.width + 'px'; dragClone.style.height = rect.height + 'px';
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
    const target = document.elementFromPoint(e.clientX, e.clientY)?.closest('.square')?.dataset.square;
    if (dragMovedEnough && target && validMoves.includes(target)) handleMoveAttempt(draggedSquare, target);
    else if (dragMovedEnough) renderBoard(false);
}

function handleMoveAttempt(from, to) {
    const move = liveGame.moves({ square: from, verbose: true }).find(m => m.to === to);
    if (move?.flags.includes('p')) {
        promotionFrom = from; promotionTo = to;
        document.getElementById('promotion-modal').classList.remove('hidden');
        renderPromotionChoices();
    } else executeMove(from, to);
}

function executeMove(from, to, promo = 'q') {
    // ЖЕСТКАЯ ПРОВЕРКА ВРЕМЕНИ
    if (isClockEnabled && (whiteTime <= 0 || blackTime <= 0)) {
        clearSelection();
        return;
    }

    const res = liveGame.move({ from, to, promotion: promo });
    if (res) {
        if (window.playMoveSound) playMoveSound(res);
        if (!isGameStarted) { isGameStarted = true; lastTick = Date.now(); }
        else { if (liveGame.turn() === 'b') whiteTime += increment; else blackTime += increment; }
        fullMoveHistory.push(res); currentMoveIndex = fullMoveHistory.length;
        syncDisplayGame(); onMoveExecution();
    } else clearSelection();
}

function onMoveExecution() {
    selectedSquare = null; validMoves = [];
    updateMoveLog(); updateStatus(); updateClockDisplay(); renderBoard(false);
    saveGameState();
    if (!liveGame.game_over() && !(isClockEnabled && (whiteTime <= 0 || blackTime <= 0))) { 
        if (isClockEnabled) startTimer(); 
        checkAndTriggerAI(); 
    } else stopTimer();
}

function syncDisplayGame() {
    displayGame = new Chess(liveGame.fen());
    renderBoard(false);
}

// 6. ЧАСЫ И ТАЙМЕР
function startTimer() {
    stopTimer(); 
    if (!isClockEnabled || !isGameStarted || liveGame.game_over()) return;
    if (!lastTick) lastTick = Date.now();

    timerInterval = setInterval(() => {
        const now = Date.now(), delta = Math.floor((now - lastTick) / 1000);
        if (delta >= 1) {
            if (liveGame.turn() === 'w') whiteTime = Math.max(0, whiteTime - delta);
            else blackTime = Math.max(0, blackTime - delta);
            lastTick = now;

            if (whiteTime <= 0 || blackTime <= 0) { 
                stopTimer(); 
                if (stockfishWorker) stockfishWorker.postMessage('stop');
                isWaitingForAIMove = false;
                updateStatus(); 
            }
            updateClockDisplay(); saveGameState();
        }
    }, 500);
}

function stopTimer() { if (timerInterval) clearInterval(timerInterval); timerInterval = null; }

function updateClockDisplay() {
    const t = document.getElementById('clock-top'), b = document.getElementById('clock-bottom');
    if (!t || !b) return;
    const format = (s) => `${Math.floor(s/60)}:${(s%60).toString().padStart(2, '0')}`;
    (isFlipped ? t : b).textContent = format(whiteTime);
    (isFlipped ? b : t).textContent = format(blackTime);
    const turn = liveGame.turn(), active = isGameStarted && !liveGame.game_over() && whiteTime > 0 && blackTime > 0;
    t.classList.toggle('active', active && ((isFlipped && turn === 'w') || (!isFlipped && turn === 'b')));
    b.classList.toggle('active', active && ((!isFlipped && turn === 'w') || (isFlipped && turn === 'b')));
}

// 7. СИСТЕМА СОХРАНЕНИЙ И НАВИГАЦИЯ
function jumpToMoveIndex(idx) {
    if (idx < 0 || idx > fullMoveHistory.length) return;
    currentMoveIndex = idx;
    displayGame = new Chess();
    for (let i = 0; i < currentMoveIndex; i++) displayGame.move(fullMoveHistory[i]);
    selectedSquare = null; validMoves = [];
    renderBoard(false); updateMoveLog();
}

function resetGameSettings() {
    stopTimer();
    const saved = localStorage.getItem('azachess-save-game');
    if (saved) {
        try {
            const s = JSON.parse(saved);
            liveGame = new Chess(s.fen);
            fullMoveHistory = s.history;
            currentMoveIndex = s.currentIdx;
            whiteTime = s.whiteTime; blackTime = s.blackTime; lastTick = s.lastTick;
            isGameStarted = s.isGameStarted; userColor = s.userColor; isFlipped = s.isFlipped;
            isClockEnabled = s.isClockEnabled; increment = s.increment;
            displayGame = new Chess();
            for (let i = 0; i < currentMoveIndex; i++) displayGame.move(fullMoveHistory[i]);
            
            if (isGameStarted && lastTick && !liveGame.game_over()) {
                const elapsed = Math.floor((Date.now() - lastTick) / 1000);
                if (liveGame.turn() === 'w') whiteTime = Math.max(0, whiteTime - elapsed);
                else blackTime = Math.max(0, blackTime - elapsed);
                lastTick = Date.now();
            }
        } catch(e) { localStorage.removeItem('azachess-save-game'); return resetGameSettings(); }
    } else {
        liveGame = new Chess(); displayGame = new Chess();
        userColor = localStorage.getItem('selected-player-color') || 'w';
        if (userColor === 'random') userColor = Math.random() > 0.5 ? 'w' : 'b';
        isFlipped = (userColor === 'b');
        const timeVal = localStorage.getItem('selected-time-control') || '5+3';
        if (timeVal === 'none') isClockEnabled = false;
        else {
            const p = timeVal.split('+'); 
            whiteTime = parseInt(p[0]) * 60; 
            blackTime = whiteTime; 
            increment = parseInt(p[1]) || 0;
        }
    }
    const cw = document.getElementById('clocks-wrapper');
    if (cw) cw.style.display = isClockEnabled ? 'flex' : 'none';
    updateClockDisplay(); updateMoveLog(); updateStatus(); renderBoard(true);
    if (isGameStarted) startTimer();
    checkAndTriggerAI();
}

function saveGameState() {
    const state = {
        fen: liveGame.fen(), history: fullMoveHistory, currentIdx: currentMoveIndex,
        whiteTime, blackTime, lastTick, isGameStarted, userColor, isFlipped, isClockEnabled, increment
    };
    localStorage.setItem('azachess-save-game', JSON.stringify(state));
}

function updateStatus() {
    const s = document.getElementById('status-text'); if (!s) return;
    if (isClockEnabled && whiteTime <= 0) s.textContent = 'Белые: время вышло!';
    else if (isClockEnabled && blackTime <= 0) s.textContent = 'Черные: время вышло!';
    else if (liveGame.in_checkmate()) s.textContent = 'Мат!';
    else s.textContent = liveGame.turn()==='w' ? 'Ход белых' : 'Ход черных';
}

function checkAndTriggerAI() { 
    if (isClockEnabled && (whiteTime <= 0 || blackTime <= 0)) return;
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

function startNewGame() { if (confirm("Начать новую игру?")) { localStorage.removeItem('azachess-save-game'); resetGameSettings(); } }
function flipBoard() { isFlipped = !isFlipped; renderBoard(true); updateClockDisplay(); }
function clearSelection() { selectedSquare = null; validMoves = []; renderBoard(false); }

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

function renderPromotionChoices() {
    const container = document.querySelector('.promotion-choices'), turn = liveGame.turn();
    container.innerHTML = '';
    ['q','r','b','n'].forEach(p => {
        const btn = document.createElement('button'); btn.className = 'promo-btn';
        btn.innerHTML = `<img src="${PIECE_IMAGES[turn+p.toUpperCase()]}" style="width:100%">`;
        btn.onclick = () => { executeMove(promotionFrom, promotionTo, p); document.getElementById('promotion-modal').classList.add('hidden'); };
        container.appendChild(btn);
    });
}

// ФУНКЦИЯ СОХРАНЕНИЯ В БАЗУ (АРХИВ)
let isGameOverSaved = false; // Флаг, чтобы не сохранять дважды

function saveToPermanentArchive(reason) {
    if (isGameOverSaved || fullMoveHistory.length < 2) return; 
    isGameOverSaved = true;

    const archive = JSON.parse(localStorage.getItem('azachess-archive') || '[]');
    
    const gameRecord = {
        id: Date.now(),
        date: new Date().toLocaleString(),
        result: reason,
        // Сохраняем историю как массив объектов для точности
        history: fullMoveHistory, 
        fen: liveGame.fen(),
        timeControl: localStorage.getItem('selected-time-control'),
        userColor: userColor
    };

    archive.unshift(gameRecord);
    localStorage.setItem('azachess-archive', JSON.stringify(archive));
    console.log("Партия заархивирована.");
}

// Вызываем это в updateStatus
const originalUpdateStatus = updateStatus;
updateStatus = function() {
    originalUpdateStatus();
    const s = document.getElementById('status-text').textContent;
    // Если игра закончена (Мат, Пат или Время)
    if (liveGame.game_over() || s.includes('вышло')) {
        saveToPermanentArchive(s);
    }
};

// Сбрасываем флаг при новой игре
const originalReset = resetGameSettings;
resetGameSettings = function() {
    isGameOverSaved = false;
    originalReset();
};
