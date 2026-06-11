import { db, collection, addDoc } from "./firebase-logic.js";

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
    1: { skill: 0, depth: 1 }, 
    2: { skill: 3, depth: 2 }, 
    3: { skill: 6, depth: 4 }, 
    4: { skill: 10, depth: 6 }, 
    5: { skill: 14, depth: 8 }, 
    6: { skill: 17, depth: 12 }, 
    7: { skill: 20, depth: 15 }, 
    8: { skill: 20, depth: 20 } 
};

// СОСТОЯНИЕ
let liveGame = null;
let displayGame = null;

let fullMoveHistory = [], currentMoveIndex = 0;
let whiteTime = 300, blackTime = 300, increment = 0, lastTick = null;
let isClockEnabled = true, isGameStarted = false, timerInterval = null;
let isFlipped = false, userColor = 'w', isGameOverSaved = false;

let selectedSquare = null, validMoves = [];
let isDragging = false, dragStartX = 0, dragStartY = 0, dragClone = null, draggedPieceImg = null, draggedSquare = null, dragMovedEnough = false;

// ПЕРЕМЕННЫЕ ИИ С УПРАВЛЕНИЕМ СЕССИЯМИ
let stockfishWorker = null, isStockfishReady = false, isWaitingForAIMove = false;
let currentGameSessionId = 0; 

let promotionFrom = null, promotionTo = null;
const DRAG_THRESHOLD = 10;

// ЗАПУСК
function initApp() {
    try {
        console.log("Запуск Azachess...");
        const uid = localStorage.getItem('azachess-user-id');
        if (!uid || uid === "null") {
            window.location.href = 'auth.html';
            return;
        }

        // Применяем настройки
        applyGlobalSettings();

        // Привязка кнопок
        const setup = (id, fn) => { const el = document.getElementById(id); if (el) el.onclick = fn; };
        setup('btn-new-game', startNewGame);
        setup('btn-flip', flipBoard);
        setup('btn-nav-first', () => jumpToMoveIndex(0));
        setup('btn-nav-prev', () => jumpToMoveIndex(currentMoveIndex - 1));
        setup('btn-nav-next', () => jumpToMoveIndex(currentMoveIndex + 1));
        setup('btn-nav-last', () => jumpToMoveIndex(fullMoveHistory.length));

        // Навешиваем клавиатуру один раз
        if (!window.azachessKeydownAttached) {
            window.addEventListener('keydown', (e) => {
                if (e.key === 'ArrowLeft') { e.preventDefault(); jumpToMoveIndex(currentMoveIndex - 1); }
                if (e.key === 'ArrowRight') { e.preventDefault(); jumpToMoveIndex(currentMoveIndex + 1); }
            });
            window.azachessKeydownAttached = true;
        }

        // Аварийный клик на фон модального окна превращения
        const promoModal = document.getElementById('promotion-modal');
        if (promoModal) {
            promoModal.addEventListener('click', (e) => {
                if (e.target === promoModal) {
                    console.log("Аварийное превращение: выбран Ферзь (Q) по клику на фон.");
                    executeMove(promotionFrom, promotionTo, 'q');
                    promoModal.classList.add('hidden');
                }
            });
        }

        resetGameSettings();
    } catch (e) {
        console.error("Ошибка при запуске приложения (initApp):", e);
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}

function terminateStockfish() {
    if (stockfishWorker) {
        try {
            stockfishWorker.postMessage('stop');
            stockfishWorker.terminate();
        } catch (e) {
            console.warn("Ошибка завершения воркера Stockfish:", e);
        }
        stockfishWorker = null;
    }
    isStockfishReady = false;
    isWaitingForAIMove = false;
}

function initStockfish(sessionId) {
    try {
        const blob = new Blob([`importScripts('https://cdnjs.cloudflare.com/ajax/libs/stockfish.js/10.0.2/stockfish.js');`], { type: 'application/javascript' });
        stockfishWorker = new Worker(URL.createObjectURL(blob));
        stockfishWorker.onmessage = (e) => {
            if (sessionId !== currentGameSessionId) return;

            if (e.data === 'readyok') {
                isStockfishReady = true;
                console.log("Движок Stockfish готов к работе.");
                if (liveGame && liveGame.turn() !== userColor && !liveGame.game_over()) {
                    triggerEngineMove();
                }
            }
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
    } catch (err) { 
        console.error("Ошибка инициализации Stockfish:", err); 
    }
}

function renderBoard(rebuild = false) {
    try {
        const boardEl = document.getElementById('board');
        if (!boardEl) return;

        const showHints = localStorage.getItem('azachess-setting-hints') !== 'false';

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

                    // Отрисовка координат
                    if (r === 7) {
                        const fileLabel = document.createElement('span');
                        fileLabel.className = 'coordinate file';
                        fileLabel.textContent = String.fromCharCode(97 + col);
                        sq.appendChild(fileLabel);
                    }
                    if (c === 0) {
                        const rankLabel = document.createElement('span');
                        rankLabel.className = 'coordinate rank';
                        rankLabel.textContent = row + 1;
                        sq.appendChild(rankLabel);
                    }

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
                if (!img) { 
                    img = document.createElement('img'); 
                    img.className = 'piece'; 
                    img.draggable = false; 
                    sq.appendChild(img); 
                }
                img.src = PIECE_IMAGES[`${piece.color}${piece.type.toUpperCase()}`];
            } else if (img) sq.removeChild(img);
            
            const m = sq.querySelector('.move-dest, .move-dest-capture');
            if (m) sq.removeChild(m);

            if (showHints && currentMoveIndex === fullMoveHistory.length && validMoves.includes(name)) {
                const dest = document.createElement('div');
                dest.className = piece ? 'move-dest-capture' : 'move-dest';
                sq.appendChild(dest);
            }
        });
    } catch (e) {
        console.error("Ошибка рендеринга доски (renderBoard):", e);
    }
}

function handlePointerDown(e, sq) {
    if (typeof window.unlockAudio === 'function') window.unlockAudio();
    const isTimeOut = isClockEnabled && (whiteTime <= 0 || blackTime <= 0);
    if (liveGame.game_over() || isWaitingForAIMove || currentMoveIndex < fullMoveHistory.length || isTimeOut) return;
    if (selectedSquare && validMoves.includes(sq)) { handleMoveAttempt(selectedSquare, sq); return; }
    const piece = liveGame.get(sq);
    if (piece && piece.color === userColor && piece.color === liveGame.turn()) {
        isDragging = true; 
        dragMovedEnough = false; 
        draggedSquare = sq;
        dragStartX = e.clientX; 
        dragStartY = e.clientY;
        draggedPieceImg = e.target.classList.contains('piece') ? e.target : e.target.querySelector('.piece');
        selectedSquare = sq; 
        validMoves = liveGame.moves({ square: sq, verbose: true }).map(m => m.to);
        renderBoard(false);
        window.onpointermove = handlePointerMove; 
        window.onpointerup = handlePointerUp;
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
    isDragging = false; 
    window.onpointermove = null; 
    window.onpointerup = null;
    if (dragClone) { document.body.removeChild(dragClone); dragClone = null; }
    if (draggedPieceImg) draggedPieceImg.style.visibility = 'visible';
    const target = document.elementFromPoint(e.clientX, e.clientY)?.closest('.square')?.dataset.square;
    if (dragMovedEnough && target && validMoves.includes(target)) handleMoveAttempt(draggedSquare, target);
    else if (dragMovedEnough) renderBoard(false);
}

function handleMoveAttempt(from, to) {
    const piece = liveGame.get(from);
    const isPawn = piece?.type === 'p';
    const isPromotionRank = (piece?.color === 'w' && to[1] === '8') || (piece?.color === 'b' && to[1] === '1');

    console.log("Попытка хода с:", from, "на:", to, "Фигура:", piece ? piece.type : "нет");

    if (isPawn && isPromotionRank) {
        // ПРОВЕРКА НАСТРОЙКИ АВТО-ФЕРЗЯ
        const autoQueen = localStorage.getItem('azachess-setting-autoqueen') === 'true';
        if (autoQueen) {
            console.log("Применено автоматическое превращение в ферзя (Auto-Queen):", from, "->", to);
            executeMove(from, to, 'q');
        } else {
            promotionFrom = from; 
            promotionTo = to;
            console.log("Открытие модального окна превращения пешки:", from, "->", to);
            document.getElementById('promotion-modal').classList.remove('hidden');
            renderPromotionChoices();
        }
    } else {
        executeMove(from, to);
    }
}

function executeMove(from, to, promo = 'q') {
    if (isClockEnabled && (whiteTime <= 0 || blackTime <= 0)) { clearSelection(); return; }
    
    console.log("Выполнение хода:", from, "->", to, "Превращение в:", promo);
    const res = liveGame.move({ from, to, promotion: promo });
    if (res) {
        if (window.playMoveSound) window.playMoveSound(res);
        if (!isGameStarted) { isGameStarted = true; lastTick = Date.now(); }
        else { if (liveGame.turn() === 'b') whiteTime += increment; else blackTime += increment; }
        fullMoveHistory.push(res); 
        currentMoveIndex = fullMoveHistory.length;
        syncDisplayGame(); 
        onMoveExecution();
    } else {
        clearSelection();
    }
}

function onMoveExecution() {
    selectedSquare = null; 
    validMoves = [];
    updateMoveLog(); 
    updateStatus(); 
    updateClockDisplay(); 
    renderBoard(false);
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

function jumpToMoveIndex(idx) {
    if (idx < 0 || idx > fullMoveHistory.length) return;
    currentMoveIndex = idx;
    displayGame = new Chess();
    for (let i = 0; i < currentMoveIndex; i++) displayGame.move(fullMoveHistory[i]);
    selectedSquare = null; 
    validMoves = [];
    renderBoard(false); 
    updateMoveLog();
}

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
            saveGameState(); 
            if (whiteTime <= 0 || blackTime <= 0) { 
                stopTimer(); 
                if (stockfishWorker) stockfishWorker.postMessage('stop');
                isWaitingForAIMove = false;
                updateStatus(); 
                saveGameState(); 
            }
            updateClockDisplay(); 
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

function saveGameState() {
    const isTimeout = isClockEnabled && (whiteTime <= 0 || blackTime <= 0);
    
    if ((liveGame && liveGame.game_over()) || isTimeout) {
        console.log("Сохранение прервано: партия завершена. Файл сохранения удален.");
        localStorage.removeItem('azachess-save-game');
        return;
    }

    const state = {
        fen: liveGame.fen(), history: fullMoveHistory, currentIdx: currentMoveIndex,
        whiteTime, blackTime, lastTick, isGameStarted, userColor, isFlipped, isClockEnabled, increment
    };
    localStorage.setItem('azachess-save-game', JSON.stringify(state));
}

function resetGameSettings() {
    try {
        stopTimer();
        terminateStockfish(); 

        currentGameSessionId++; 
        const thisSessionId = currentGameSessionId;

        isGameOverSaved = false;
        const saved = localStorage.getItem('azachess-save-game');
        
        if (typeof Chess !== 'function') {
            throw new Error("Библиотека chess.js не загружена.");
        }

        if (saved) {
            try {
                const s = JSON.parse(saved);
                liveGame = new Chess(s.fen); 
                fullMoveHistory = s.history; 
                currentMoveIndex = s.currentIdx;
                whiteTime = s.whiteTime; 
                blackTime = s.blackTime; 
                lastTick = s.lastTick;
                isGameStarted = s.isGameStarted; 
                userColor = s.userColor; 
                isFlipped = s.isFlipped;
                isClockEnabled = s.isClockEnabled; 
                increment = s.increment;
                displayGame = new Chess();
                for (let i = 0; i < currentMoveIndex; i++) displayGame.move(fullMoveHistory[i]);
                if (isGameStarted && lastTick && !liveGame.game_over() && whiteTime > 0 && blackTime > 0) {
                    const elapsed = Math.floor((Date.now() - lastTick) / 1000);
                    if (liveGame.turn() === 'w') whiteTime = Math.max(0, whiteTime - elapsed);
                    else blackTime = Math.max(0, blackTime - elapsed);
                    lastTick = Date.now();
                }
            } catch(e) { 
                console.warn("Ошибка восстановления игры, сбрасываем:", e);
                localStorage.removeItem('azachess-save-game'); 
                return resetGameSettings(); 
            }
        } else {
            liveGame = new Chess(); 
            displayGame = new Chess();
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
        
        window.game = liveGame;

        const cw = document.getElementById('clocks-wrapper');
        if (cw) cw.style.display = isClockEnabled ? 'flex' : 'none';
        updateClockDisplay(); 
        updateMoveLog(); 
        updateStatus(); 
        renderBoard(true);

        initStockfish(thisSessionId);

        if (isGameStarted && !liveGame.game_over() && (whiteTime > 0 && blackTime > 0)) startTimer();
        checkAndTriggerAI();
    } catch (err) {
        console.error("Ошибка resetGameSettings:", err);
    }
}

function updateStatus() {
    const s = document.getElementById('status-text'); if (!s) return;
    let statusText = "";
    let isOver = false;

    if (isClockEnabled && whiteTime <= 0) {
        statusText = 'Белые: время вышло!';
        isOver = true;
    } else if (isClockEnabled && blackTime <= 0) {
        statusText = 'Черные: время вышло!';
        isOver = true;
    } else if (liveGame.game_over()) {
        isOver = true;
        if (liveGame.in_checkmate()) statusText = 'Мат!';
        else if (liveGame.in_draw()) statusText = 'Ничья!';
        else statusText = 'Игра окончена';
    } else {
        statusText = liveGame.turn()==='w' ? 'Ход белых' : 'Ход черных';
    }

    s.textContent = statusText;

    if (isOver) {
        localStorage.removeItem('azachess-save-game');
        if (!isGameOverSaved) saveToPermanentArchive(statusText);
    }
}

async function saveToPermanentArchive(reason) {
    const userId = localStorage.getItem('azachess-user-id');
    if (!userId || userId === "null" || isGameOverSaved || fullMoveHistory.length < 2) return;
    isGameOverSaved = true;
    
    console.log("Запись партии в архив Firestore...");
    const gameData = { 
        id: Date.now(), 
        userId, 
        date: new Date().toLocaleString(), 
        result: reason, 
        aiLevel: localStorage.getItem('selected-ai-level') || '3',
        history: fullMoveHistory.map(m => ({from: m.from, to: m.to, san: m.san, promotion: m.promotion || null})), 
        fen: liveGame.fen(), 
        timeControl: localStorage.getItem('selected-time-control') || '5+3', 
        userColor 
    };

    // Сохраняем локальный кэш
    const archive = JSON.parse(localStorage.getItem('azachess-archive') || '[]');
    archive.unshift(gameData);
    localStorage.setItem('azachess-archive', JSON.stringify(archive));

    try {
        const userHistoryRef = collection(db, "users", userId, "history");
        await addDoc(userHistoryRef, gameData);
        console.log("Партия успешно записана в облачную историю Firestore!");
    } catch (e) { 
        console.error("Firebase Error при сохранении архива:", e); 
    }
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

function startNewGame() { 
    if (confirm("Начать новую игру?")) { 
        localStorage.removeItem('azachess-save-game'); 
        resetGameSettings(); 
    } 
}

// Поворот доски
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
    if (!container) return;
    container.innerHTML = '';
    ['q','r','b','n'].forEach(p => {
        const btn = document.createElement('button'); btn.className = 'promo-btn';
        btn.innerHTML = `<img src="${PIECE_IMAGES[turn+p.toUpperCase()]}" style="width:100%; height:100%; pointer-events: none;">`;
        
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            console.log("Игрок выбрал фигуру для превращения:", p);
            executeMove(promotionFrom, promotionTo, p); 
            document.getElementById('promotion-modal').classList.add('hidden'); 
        });
        
        container.appendChild(btn);
    });
}

function applyGlobalSettings() {
    try {
        const boardEl = document.getElementById('board');
        if (!boardEl) return;

        const theme = localStorage.getItem('azachess-setting-theme') || 'emerald';
        const coords = localStorage.getItem('azachess-setting-coords') !== 'false';

        boardEl.classList.remove('theme-emerald', 'theme-classic', 'theme-blue', 'theme-charcoal');
        boardEl.classList.add(`theme-${theme}`);

        if (coords) {
            boardEl.classList.remove('hide-coordinates');
        } else {
            boardEl.classList.add('hide-coordinates');
        }
    } catch (e) {
        console.error("Ошибка applyGlobalSettings:", e);
    }
}
