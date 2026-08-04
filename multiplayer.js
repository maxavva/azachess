import { auth, db, doc, setDoc, getDoc, collection, query, where, getDocs, orderBy, limit, onSnapshot, runTransaction, deleteDoc, updateDoc, onAuthStateChanged } from "./firebase-logic.js";

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

// БЕЗОПАСНЫЙ СКАРБ ПАМЯТИ
const safeLocalStorage = {
    getItem: (key) => {
        try { return localStorage.getItem(key); } catch (e) { return null; }
    },
    setItem: (key, value) => {
        try { localStorage.setItem(key, value); } catch (e) {}
    },
    removeItem: (key) => {
        try { localStorage.removeItem(key); } catch (e) {}
    }
};

// СОСТОЯНИЕ ИГРЫ
let liveGame = null;
let displayGame = null;

let fullMoveHistory = [];
let currentMoveIndex = 0;
let whiteTime = 300, blackTime = 300, increment = 0, lastTick = null;
let timerInterval = null;
let isFlipped = false;

let selectedSquare = null, validMoves = [];
let isDragging = false, dragStartX = 0, dragStartY = 0, dragClone = null, draggedPieceImg = null, draggedSquare = null, dragMovedEnough = false;

let promotionFrom = null, promotionTo = null;
const DRAG_THRESHOLD = 10;

// СЕТЕВЫЕ ПЕРЕМЕННЫЕ
let gameListener = null;
let currentGameId = null;
let currentRole = null; // 'w', 'b' или 'spectator'
let currentUserId = null;

// Инициализация PvP арены
function initMultiplayer() {
    console.log("[Azachess-PvP] Запуск инициализации скрипта...");
    
    if (typeof Chess !== 'function') {
        alert("Критическая ошибка: Библиотека chess.js не загружена!\nПожалуйста, проверьте интернет-соединение или обновите страницу.");
        return;
    }

    onAuthStateChanged(auth, async (user) => {
        if (!user) {
            window.location.href = 'auth.html';
            return;
        }

        currentUserId = user.uid;
        safeLocalStorage.setItem('azachess-user-id', user.uid);

        applyGlobalSettings();

        // Навигационные кнопки под доской
        const setupNav = (id, fn) => { const el = document.getElementById(id); if (el) el.onclick = fn; };
        setupNav('btn-nav-first', () => jumpToMoveIndex(0));
        setupNav('btn-nav-prev', () => jumpToMoveIndex(currentMoveIndex - 1));
        setupNav('btn-nav-next', () => jumpToMoveIndex(currentMoveIndex + 1));
        setupNav('btn-nav-last', () => jumpToMoveIndex(fullMoveHistory.length));

        // Аварийный клик на фон модального окна превращения
        const promoModal = document.getElementById('promotion-modal');
        if (promoModal) {
            promoModal.addEventListener('click', (e) => {
                if (e.target === promoModal) {
                    executeMoveMultiplayer(promotionFrom, promotionTo, 'q');
                    promoModal.classList.add('hidden');
                }
            });
        }

        // Запуск комнаты напрямую
        const urlParams = new URLSearchParams(window.location.search);
        const roomId = urlParams.get('room');
        if (roomId) {
            joinRoom(roomId);
        } else {
            window.location.href = 'index.html';
        }
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initMultiplayer);
} else {
    initMultiplayer();
}

// Применение глобальных настроек оформления
function applyGlobalSettings() {
    try {
        const boardEl = document.getElementById('board');
        if (!boardEl) return;

        const theme = safeLocalStorage.getItem('azachess-setting-theme') || 'emerald';
        const coords = safeLocalStorage.getItem('azachess-setting-coords') !== 'false';

        boardEl.className = 'chessboard';
        boardEl.classList.add(`theme-${theme}`);

        if (coords) {
            boardEl.classList.remove('hide-coordinates');
        } else {
            boardEl.classList.add('hide-coordinates');
        }
    } catch (e) {
        console.error("applyGlobalSettings error:", e);
    }
}

// Управление экранами (Сжато до игрового)
function showView() {
    const views = ['lobby-view', 'searching-view', 'invite-view', 'game-view'];
    views.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.add('hidden');
    });
    const el = document.getElementById('game-view');
    if (el) el.classList.remove('hidden');
}

// Подключение к комнате
function joinRoom(gameId) {
    currentGameId = gameId;
    const userId = currentUserId;

    console.log(`[Room] Вход в игровую сессию: ${gameId}`);
    showView();

    const gameRef = doc(db, "pvp_games", gameId);
    
    gameListener = onSnapshot(gameRef, (docSnap) => {
        try {
            if (!docSnap.exists()) {
                alert("Игра завершена или удалена.");
                leaveRoom();
                return;
            }

            const data = docSnap.data();
            
            // Роль игрока
            if (userId === data.whiteId) currentRole = 'w';
            else if (userId === data.blackId) currentRole = 'b';
            else currentRole = 'spectator';

            isFlipped = (currentRole === 'b');
            document.getElementById('multiplayer-header').textContent = `Онлайн-Матч: ${data.whiteName} vs ${data.blackName}`;

            const fenToLoad = (data.fen && typeof data.fen === 'string') ? data.fen : "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

            liveGame = new Chess(fenToLoad);
            window.game = liveGame;

            const previousLength = fullMoveHistory.length;
            fullMoveHistory = data.history || [];

            // Плавный переход при новом ходе
            if (fullMoveHistory.length > previousLength || currentMoveIndex === previousLength) {
                currentMoveIndex = fullMoveHistory.length;
                displayGame = new Chess(fenToLoad);
            } else {
                displayGame = new Chess("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
                for (let i = 0; i < currentMoveIndex; i++) {
                    displayGame.move(fullMoveHistory[i]);
                }
            }

            // Защищенное чтение таймеров (Safe Defaults для исключения NaN)
            whiteTime = parseInt(data.whiteTime !== undefined ? data.whiteTime : 300);
            blackTime = parseInt(data.blackTime !== undefined ? data.blackTime : 300);
            increment = parseInt(data.increment !== undefined ? data.increment : 0);
            lastTick = parseInt(data.lastMoveTime !== undefined ? data.lastMoveTime : Date.now());

            // Скрытие часов, если выбран режим "Без времени"
            const clocksWrapper = document.getElementById('clocks-wrapper');
            if (clocksWrapper) {
                clocksWrapper.style.display = (data.timeControl === 'none') ? 'none' : 'flex';
            }

            // Воспроизводим звук последнего хода
            const lastMove = fullMoveHistory[fullMoveHistory.length - 1];
            if (lastMove && typeof window.playMoveSound === 'function') {
                window.playMoveSound(lastMove);
            }

            renderBoard(true);
            updateMoveLog();
            updateClockDisplay();
            updateStatusMultiplayer(data);

            if (data.status === 'active' && fullMoveHistory.length > 0) {
                startTimerMultiplayer();
            } else {
                stopTimerMultiplayer();
            }
        } catch (roomErr) {
            console.error("[Room] Ошибка внутри onSnapshot игрового цикла:", roomErr);
            alert(`Ошибка отрисовки игры!\n\nСообщение: ${roomErr.message}\n\nСтек трейс:\n${roomErr.stack}`);
        }
    }, (error) => {
        alert(`Ошибка доступа к серверу игры!\n\nСистемный код: ${error.code}\nТекст: ${error.message}`);
    });
}

// Обновление игрового статуса
function updateStatusMultiplayer(data) {
    const s = document.getElementById('status-text');
    if (!s) return;

    let statusText = "";
    let isOver = false;

    if (currentRole === 'spectator') {
        statusText = "Режим зрителя (Наблюдение за игрой)";
    } else if (data.status === 'active') {
        if (currentRole === data.turn) {
            statusText = "Ваш ход!";
        } else {
            statusText = `Ход соперника (${data.turn === 'w' ? 'Белые' : 'Черные'})`;
        }
    } else if (data.status === 'checkmate') {
        const winnerName = data.winner === 'w' ? data.whiteName : data.blackName;
        statusText = `Мат! Победитель: ${winnerName}`;
        isOver = true;
    } else if (data.status === 'draw') {
        statusText = "Ничья!";
        isOver = true;
    } else if (data.status === 'resign') {
        const winnerName = data.winner === 'w' ? data.whiteName : data.blackName;
        statusText = `Сдача! Победитель: ${winnerName}`;
        isOver = true;
    } else if (data.status === 'timeout') {
        const winnerName = data.winner === 'w' ? data.whiteName : data.blackName;
        statusText = `Время истекло! Победитель: ${winnerName}`;
        isOver = true;
    }

    s.textContent = statusText;

    if (isOver) {
        stopTimerMultiplayer();
        saveOnlineGameToArchive(data);

        const resignBtn = document.getElementById('btn-resign');
        if (resignBtn) {
            resignBtn.textContent = "Выйти в лобби";
            resignBtn.className = "btn";
            resignBtn.onclick = leaveRoom;
        }
    } else {
        const resignBtn = document.getElementById('btn-resign');
        if (resignBtn) {
            resignBtn.textContent = "Сдаться";
            resignBtn.className = "btn btn-danger";
            resignBtn.onclick = resignGame;
        }
    }
}

// Локальный плавный таймер отсчета времени
function startTimerMultiplayer() {
    stopTimerMultiplayer();
    if (!lastTick) return;

    timerInterval = setInterval(() => {
        const turn = liveGame.turn();
        const elapsed = Math.floor((Date.now() - lastTick) / 1000);

        let localWhite = whiteTime;
        let localBlack = blackTime;

        if (turn === 'w') {
            localWhite = Math.max(0, whiteTime - elapsed);
        } else {
            localBlack = Math.max(0, blackTime - elapsed);
        }

        renderClockDisplayLocally(localWhite, localBlack, turn);

        if (turn === currentRole) {
            if ((turn === 'w' && localWhite <= 0) || (turn === 'b' && localBlack <= 0)) {
                triggerTimeout();
            }
        }
    }, 250);
}

function stopTimerMultiplayer() {
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = null;
}

// Запись падения по времени
async function triggerTimeout() {
    stopTimerMultiplayer();
    try {
        const gameRef = doc(db, "pvp_games", currentGameId);
        await updateDoc(gameRef, {
            status: "timeout",
            winner: currentRole === 'w' ? 'b' : 'w'
        });
    } catch(e) {
        console.error("Timeout trigger failed:", e);
    }
}

// Сдача
async function resignGame() {
    if (confirm("Вы уверены, что хотите сдаться?")) {
        try {
            const gameRef = doc(db, "pvp_games", currentGameId);
            await updateDoc(gameRef, {
                status: "resign",
                winner: currentRole === 'w' ? 'b' : 'w'
            });
        } catch(e) {
            console.error(e);
        }
    }
}

// Выход в лобби
function leaveRoom() {
    stopTimerMultiplayer();
    if (gameListener) {
        gameListener();
        gameListener = null;
    }
    currentGameId = null;
    currentRole = null;
    window.location.href = 'index.html'; // Назад на обновленный главный дашборд
}

// Сохранение PvP игры в личный архив
async function saveOnlineGameToArchive(data) {
    const userId = currentUserId;
    if (!userId || data.history.length < 2) return;

    const archiveKey = `pvp-archived-${data.id}`;
    if (safeLocalStorage.getItem(archiveKey)) return;

    safeLocalStorage.setItem(archiveKey, "true");

    let statusReason = "Игра окончена";
    let outcome = 0.5;

    if (data.status === 'checkmate' || data.status === 'resign' || data.status === 'timeout') {
        if (data.winner === currentRole) {
            statusReason = `Победа (${data.winner === 'w' ? 'Белые' : 'Черные'})`;
            outcome = 1;
        } else {
            statusReason = `Поражение (${data.winner === 'w' ? 'Белые' : 'Черные'})`;
            outcome = 0;
        }
    } else if (data.status === 'draw') {
        statusReason = "Ничья";
        outcome = 0.5;
    }

    const stats = await getUserStats(userId);
    const newWins = stats.wins + (outcome === 1 ? 1 : 0);
    const newLosses = stats.losses + (outcome === 0 ? 1 : 0);
    const newDraws = stats.draws + (outcome === 0.5 ? 1 : 0);
    const newPlayed = stats.gamesPlayed + 1;

    try {
        await setDoc(doc(db, "users", userId), {
            wins: newWins,
            losses: newLosses,
            draws: newDraws,
            gamesPlayed: newPlayed
        }, { merge: true });
    } catch (err) {
        console.error("Ошибка обновления статистики в профиле:", err);
    }

    const gameData = {
        id: data.id,
        userId,
        date: new Date(data.createdAt).toLocaleString(),
        result: statusReason,
        aiLevel: "PvP-Онлайн",
        history: data.history,
        fen: data.fen,
        timeControl: data.timeControl,
        userColor: userId === data.whiteId ? 'w' : 'b'
    };

    let archive = [];
    try {
        archive = JSON.parse(safeLocalStorage.getItem('azachess-archive') || '[]');
    } catch(e) { archive = []; }
    archive.unshift(gameData);
    safeLocalStorage.setItem('azachess-archive', JSON.stringify(archive));

    try {
        const userHistoryRef = doc(db, "users", userId, "history", data.id);
        await setDoc(userHistoryRef, gameData);
    } catch(e) {
        console.error("Ошибка синхронизации истории PvP:", e);
    }
}

// Отрендерить часы локально
function renderClockDisplayLocally(w, b, turn) {
    const clockTop = document.getElementById('clock-top');
    const clockBottom = document.getElementById('clock-bottom');
    if (!clockTop || !clockBottom) return;

    const format = (s) => `${Math.floor(s/60)}:${(s%60).toString().padStart(2, '0')}`;
    
    (isFlipped ? clockTop : clockBottom).textContent = format(w);
    (isFlipped ? clockBottom : clockTop).textContent = format(b);

    clockTop.classList.toggle('active', (isFlipped && turn === 'w') || (!isFlipped && turn === 'b'));
    clockBottom.classList.toggle('active', (!isFlipped && turn === 'w') || (isFlipped && turn === 'b'));
}

// Получить статистику игрока
async function getUserStats(uid) {
    try {
        const snap = await getDoc(doc(db, "users", uid));
        if (snap.exists()) {
            const data = snap.data();
            return {
                username: data.username || "Игрок",
                wins: data.wins || 0,
                losses: data.losses || 0,
                draws: data.draws || 0,
                gamesPlayed: data.gamesPlayed || 0
            };
        }
    } catch (e) {
        console.error("Error loading user stats:", e);
    }
    return { username: "Игрок", wins: 0, losses: 0, draws: 0, gamesPlayed: 0 };
}

// Отрисовка шахматной доски
function renderBoard(rebuild = false) {
    const boardEl = document.getElementById('board');
    if (!boardEl) return;

    const showHints = safeLocalStorage.getItem('azachess-setting-hints') !== 'false';

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
        
        // Кросс-версионная проверка шаха на доске
        const checkActive = isGameInCheck(displayGame);
        if (checkActive && piece?.type === 'k' && piece.color === displayGame.turn()) {
            sq.classList.add('check');
        }
        
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
}

// Клики и перетаскивание фигур (Pointer Events с захватом для тач-скринов)
function handlePointerDown(e, sq) {
    try {
        if (e && e.cancelable) e.preventDefault();
    } catch(err) {}
    
    if (typeof window.unlockAudio === 'function') window.unlockAudio();
    
    if (currentRole !== liveGame.turn() || currentMoveIndex < fullMoveHistory.length) {
        return;
    }

    if (selectedSquare && validMoves.includes(sq)) { 
        handleMoveAttempt(selectedSquare, sq); 
        return; 
    }

    const piece = liveGame.get(sq);
    if (piece && piece.color === currentRole) {
        isDragging = true; 
        dragMovedEnough = false; 
        draggedSquare = sq;
        dragStartX = e.clientX; 
        dragStartY = e.clientY;
        draggedPieceImg = e.target.classList.contains('piece') ? e.target : e.target.querySelector('.piece');
        selectedSquare = sq; 
        
        validMoves = liveGame.moves({ square: sq, verbose: true }).map(m => m.to.split('=')[0].trim());
        
        renderBoard(false);
        window.onpointermove = handlePointerMove; 
        window.onpointerup = handlePointerUp;

        try { e.target.setPointerCapture(e.pointerId); } catch(err) {}
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
    isDragging = false; 
    window.onpointermove = null; 
    window.onpointerup = null;

    try { e.target.releasePointerCapture(e.pointerId); } catch(err) {}

    if (dragClone) { document.body.removeChild(dragClone); dragClone = null; }
    if (draggedPieceImg) draggedPieceImg.style.visibility = 'visible';
    const target = document.elementFromPoint(e.clientX, e.clientY)?.closest('.square')?.dataset.square;
    if (dragMovedEnough && target && validMoves.includes(target)) {
        handleMoveAttempt(draggedSquare, target);
    } else if (dragMovedEnough) {
        renderBoard(false);
    }
}

function handleMoveAttempt(from, to) {
    const piece = liveGame.get(from);
    const isPawn = piece?.type?.toLowerCase() === 'p';
    const isPromotionRank = (piece?.color?.toLowerCase() === 'w' && to.endsWith('8')) || (piece?.color?.toLowerCase() === 'b' && to.endsWith('1'));

    if (isPawn && isPromotionRank) {
        const autoQueen = safeLocalStorage.getItem('azachess-setting-autoqueen') === 'true';
        if (autoQueen) {
            executeMoveMultiplayer(from, to, 'q');
            return;
        }

        const promoModal = document.getElementById('promotion-modal');
        if (promoModal) {
            promotionFrom = from; 
            promotionTo = to;
            promoModal.classList.remove('hidden');
            renderPromotionChoices();
        } else {
            executeMoveMultiplayer(from, to, 'q');
        }
    } else {
        executeMoveMultiplayer(from, to);
    }
}

// Отправка хода на Firestore с мгновенной компенсацией задержки (Optimistic UI)
async function executeMoveMultiplayer(from, to, promo = 'q') {
    if (currentRole !== liveGame.turn()) return;

    const gameClone = new Chess(liveGame.fen());
    const res = gameClone.move({ from, to, promotion: promo });
    if (!res) {
        clearSelection();
        return;
    }

    const now = Date.now();
    let elapsed = 0;
    if (fullMoveHistory.length > 0 && lastTick) {
        elapsed = Math.floor((now - lastTick) / 1000);
    }

    let newWhiteTime = whiteTime;
    let newBlackTime = blackTime;

    if (currentRole === 'w') {
        newWhiteTime = Math.max(0, whiteTime - elapsed) + increment;
    } else {
        newBlackTime = Math.max(0, blackTime - elapsed) + increment;
    }

    const newHistory = [...fullMoveHistory, {
        from: res.from,
        to: res.to,
        san: res.san,
        promotion: promo || null,
        flags: res.flags
    }];

    let status = "active";
    let winner = null;

    if (isGameFinished(gameClone)) {
        if (isCheckmate(gameClone)) {
            status = "checkmate";
            winner = currentRole;
        } else {
            status = "draw";
            winner = "draw";
        }
    }

    liveGame = new Chess(gameClone.fen());
    window.game = liveGame;
    fullMoveHistory = newHistory;
    currentMoveIndex = fullMoveHistory.length;
    displayGame = new Chess(gameClone.fen());

    if (currentRole === 'w') {
        whiteTime = newWhiteTime;
    } else {
        blackTime = newBlackTime;
    }
    lastTick = now;

    selectedSquare = null;
    validMoves = [];

    renderBoard(false);
    updateMoveLog();
    updateClockDisplay();
    
    if (typeof window.playMoveSound === 'function') {
        window.playMoveSound(res);
    }

    if (status === 'active') {
        startTimerMultiplayer();
    } else {
        stopTimerMultiplayer();
    }

    try {
        const gameRef = doc(db, "pvp_games", currentGameId);
        await updateDoc(gameRef, {
            fen: gameClone.fen(),
            history: newHistory,
            turn: gameClone.turn(),
            whiteTime: newWhiteTime,
            blackTime: newBlackTime,
            lastMoveTime: now,
            status: status,
            winner: winner
        });
    } catch (err) {
        console.error("Firestore move update error:", err);
        alert("Не удалось зафиксировать ход на сервере.");
        renderBoard(false);
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
            executeMoveMultiplayer(promotionFrom, promotionTo, p); 
            document.getElementById('promotion-modal').classList.add('hidden'); 
        });
        
        container.appendChild(btn);
    });
}

// Отрисовка времени на часах
function updateClockDisplay() {
    const format = (s) => `${Math.floor(s/60)}:${(s%60).toString().padStart(2, '0')}`;
    const clockTop = document.getElementById('clock-top');
    const clockBottom = document.getElementById('clock-bottom');
    if (clockTop && clockBottom) {
        (isFlipped ? clockTop : clockBottom).textContent = format(whiteTime);
        (isFlipped ? clockBottom : clockTop).textContent = format(blackTime);
    }
}

// Переход по истории ходов
function jumpToMoveIndex(idx) {
    if (idx < 0 || idx > fullMoveHistory.length) return;
    currentMoveIndex = idx;
    displayGame = new Chess("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
    for (let i = 0; i < currentMoveIndex; i++) {
        displayGame.move(fullMoveHistory[i]);
    }
    selectedSquare = null; 
    validMoves = [];
    renderBoard(false); 
    updateMoveLog();
}

// Обновление лога ходов
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

// Сброс выделения
function clearSelection() { selectedSquare = null; validMoves = []; renderBoard(false); }
