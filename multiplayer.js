import { auth, db, doc, setDoc, getDoc, collection, query, where, getDocs, orderBy, limit, onSnapshot, runTransaction, deleteDoc, updateDoc } from "./firebase-logic.js";

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

// СОСТОЯНИЕ
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

// ЛОББИ И ПОДБОР ПЕРЕМЕННЫЕ
let selectedTimeControl = "5+3";
let queueListener = null;
let gameListener = null;
let currentGameId = null;
let currentRole = null; // 'w', 'b' или 'spectator'
let searchSeconds = 0;
let searchTimerInterval = null;

// Инициализация
function initMultiplayer() {
    const uid = localStorage.getItem('azachess-user-id');
    if (!uid || uid === "null") {
        window.location.href = 'auth.html';
        return;
    }

    applyGlobalSettings();
    setupTimeControlPvP();

    document.getElementById('btn-start-search').onclick = startMatchmaking;
    document.getElementById('btn-cancel-search').onclick = cancelMatchmaking;

    // Навигационные кнопки под доской
    const setup = (id, fn) => { const el = document.getElementById(id); if (el) el.onclick = fn; };
    setup('btn-nav-first', () => jumpToMoveIndex(0));
    setup('btn-nav-prev', () => jumpToMoveIndex(currentMoveIndex - 1));
    setup('btn-nav-next', () => jumpToMoveIndex(currentMoveIndex + 1));
    setup('btn-nav-last', () => jumpToMoveIndex(fullMoveHistory.length));

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

    showView('lobby');
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initMultiplayer);
} else {
    initMultiplayer();
}

// Управление экранами (переключение видов)
function showView(view) {
    document.getElementById('lobby-view').classList.add('hidden');
    document.getElementById('searching-view').classList.add('hidden');
    document.getElementById('game-view').classList.add('hidden');

    if (view === 'lobby') {
        document.getElementById('lobby-view').classList.remove('hidden');
        document.getElementById('multiplayer-header').textContent = "Онлайн PvP-Арена";
    } else if (view === 'searching') {
        document.getElementById('searching-view').classList.remove('hidden');
        document.getElementById('multiplayer-header').textContent = "Поиск игры";
    } else if (view === 'game') {
        document.getElementById('game-view').classList.remove('hidden');
    }
}

// Выбор времени в PvP
function setupTimeControlPvP() {
    document.querySelectorAll('#time-grid-pvp .grid-item').forEach(el => {
        el.onclick = () => {
            document.querySelectorAll('#time-grid-pvp .grid-item').forEach(i => i.classList.remove('active'));
            el.classList.add('active');
            selectedTimeControl = el.dataset.time;
        };
    });
}

// Запуск подбора (Матчмейкинг v2 - Точечный)
async function startMatchmaking() {
    const userId = localStorage.getItem('azachess-user-id');
    const username = await getUserName(userId);
    const timeControl = selectedTimeControl;

    showView('searching');
    startSearchTimer();

    try {
        // 1. Ищем свободного игрока в очереди
        const qRef = collection(db, "queue");
        const q = query(qRef, where("timeControl", "==", timeControl), limit(10));
        const snap = await getDocs(q);

        // Фильтруем тех, кто еще не соединен, и сортируем по времени создания локально в памяти
        const sortedDocs = snap.docs
            .filter(d => d.id !== userId && !d.data().matchedGameId)
            .sort((a, b) => (a.data().createdAt || 0) - (b.data().createdAt || 0));

        let matchFound = false;
        let matchedGameId = null;

        for (let candidateDoc of sortedDocs) {
            const candidate = candidateDoc.data();

            // Запускаем транзакцию для предотвращения гонки за кандидата
            try {
                await runTransaction(db, async (transaction) => {
                    const candidateRef = doc(db, "queue", candidate.userId);
                    const candSnap = await transaction.get(candidateRef);
                    if (!candSnap.exists() || candSnap.data().matchedGameId) {
                        throw "Кандидат уже взят другим игроком или вышел";
                    }

                    // Генерируем уникальный ID игры
                    const gameId = doc(collection(db, "pvp_games")).id;
                    const gameRef = doc(db, "pvp_games", gameId);

                    const colors = Math.random() > 0.5 ? ['w', 'b'] : ['b', 'w'];
                    const isWhite = colors[0] === 'w';

                    const baseTime = parseTimeControl(timeControl).time;
                    const increment = parseTimeControl(timeControl).inc;

                    const gameData = {
                        id: gameId,
                        whiteId: isWhite ? userId : candidate.userId,
                        whiteName: isWhite ? username : candidate.username,
                        blackId: isWhite ? candidate.userId : userId,
                        blackName: isWhite ? candidate.username : username,
                        timeControl: timeControl,
                        fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
                        history: [],
                        turn: "w",
                        whiteTime: baseTime,
                        blackTime: baseTime,
                        increment: increment,
                        lastMoveTime: Date.now(),
                        status: "active",
                        winner: null,
                        createdAt: Date.now()
                    };

                    // Вписываем ID игры в билет очереди кандидата (он мгновенно узнает об этом)
                    transaction.update(candidateRef, { matchedGameId: gameId });

                    // Создаем игровую комнату
                    transaction.set(gameRef, gameData);
                    matchedGameId = gameId;
                    matchFound = true;
                });

                if (matchFound) break;
            } catch (txErr) {
                console.warn("Транзакция отменена:", txErr);
            }
        }

        if (matchFound) {
            stopSearchTimer();
            joinRoom(matchedGameId);
        } else {
            // 2. Если никого нет в очереди, добавляем себя и подписываемся на СВОЙ ДОКУМЕНТ ОЧЕРЕДИ
            const myQueueRef = doc(db, "queue", userId);
            await setDoc(myQueueRef, {
                userId,
                username,
                timeControl,
                matchedGameId: null,
                createdAt: Date.now()
            });

            queueListener = onSnapshot(myQueueRef, (docSnap) => {
                if (docSnap.exists()) {
                    const queueData = docSnap.data();
                    if (queueData.matchedGameId) {
                        // Соперник нашел нас, создал игру и вписал нам ее ID!
                        if (queueListener) queueListener();
                        queueListener = null;

                        // Удаляем свой билет из очереди
                        deleteDoc(myQueueRef).catch(() => {});

                        stopSearchTimer();
                        joinRoom(queueData.matchedGameId);
                    }
                }
            });
        }

    } catch (err) {
        console.error("Matchmaking error:", err);
        alert("Произошла ошибка подбора.");
        cancelMatchmaking();
    }
}

// Отмена поиска
async function cancelMatchmaking() {
    stopSearchTimer();
    const userId = localStorage.getItem('azachess-user-id');
    
    if (queueListener) {
        queueListener();
        queueListener = null;
    }

    try {
        await deleteDoc(doc(db, "queue", userId));
    } catch(e) {}

    showView('lobby');
}

// Подключение к комнате
function joinRoom(gameId) {
    currentGameId = gameId;
    const userId = localStorage.getItem('azachess-user-id');

    showView('game');

    const gameRef = doc(db, "pvp_games", gameId);
    gameListener = onSnapshot(gameRef, (docSnap) => {
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

        liveGame = new Chess(data.fen);
        window.game = liveGame; // Синхронизация с движком звуков

        const previousLength = fullMoveHistory.length;
        fullMoveHistory = data.history;

        // Плавный переход при новом ходе
        if (fullMoveHistory.length > previousLength || currentMoveIndex === previousLength) {
            currentMoveIndex = fullMoveHistory.length;
            displayGame = new Chess(data.fen);
        } else {
            displayGame = new Chess();
            for (let i = 0; i < currentMoveIndex; i++) {
                displayGame.move(fullMoveHistory[i]);
            }
        }

        whiteTime = data.whiteTime;
        blackTime = data.blackTime;
        increment = data.increment;
        lastTick = data.lastMoveTime;

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
    });
}

// Изменение статуса и сохранение в архив по завершении
function updateStatusMultiplayer(data) {
    const s = document.getElementById('status-text');
    if (!s) return;

    let statusText = "";
    let isOver = false;

    if (data.status === 'active') {
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

// Сохранение PvP игры в личный архив
async function saveOnlineGameToArchive(data) {
    const userId = localStorage.getItem('azachess-user-id');
    if (!userId || data.history.length < 2) return;

    const archiveKey = `pvp-archived-${data.id}`;
    if (localStorage.getItem(archiveKey)) return;

    localStorage.setItem(archiveKey, "true");

    let statusReason = "Игра окончена";
    if (data.status === 'checkmate') statusReason = `Мат (Победа ${data.winner === 'w' ? 'Белых' : 'Черных'})`;
    else if (data.status === 'resign') statusReason = `Сдача (Победа ${data.winner === 'w' ? 'Белых' : 'Черных'})`;
    else if (data.status === 'timeout') statusReason = `Время (Победа ${data.winner === 'w' ? 'Белых' : 'Черных'})`;
    else if (data.status === 'draw') statusReason = "Ничья";

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

    // Сохраняем в локальный кэш
    const archive = JSON.parse(localStorage.getItem('azachess-archive') || '[]');
    archive.unshift(gameData);
    localStorage.setItem('azachess-archive', JSON.stringify(archive));

    try {
        const userHistoryRef = doc(db, "users", userId, "history", data.id);
        await setDoc(userHistoryRef, gameData);
    } catch(e) {
        console.error("Ошибка синхронизации истории PvP:", e);
    }
}

// Таймер (Локальный плавный отсчет с компенсацией задержки)
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

        // Инициализация таймаута на стороне ходящего игрока
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
    showView('lobby');
}

// Отрисовка шахматной доски
function renderBoard(rebuild = false) {
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
}

// Клики и перетаскивание фигур (Pointer Events)
function handlePointerDown(e, sq) {
    if (typeof window.unlockAudio === 'function') window.unlockAudio();
    if (currentRole !== liveGame.turn() || currentMoveIndex < fullMoveHistory.length) return;

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
        const autoQueen = localStorage.getItem('azachess-setting-autoqueen') === 'true';
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

// Отправка хода на Firestore
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

    if (gameClone.game_over()) {
        if (gameClone.in_checkmate()) {
            status = "checkmate";
            winner = currentRole;
        } else {
            status = "draw";
            winner = "draw";
        }
    }

    selectedSquare = null;
    validMoves = [];

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

function updateClockDisplay() {
    const format = (s) => `${Math.floor(s/60)}:${(s%60).toString().padStart(2, '0')}`;
    const clockTop = document.getElementById('clock-top');
    const clockBottom = document.getElementById('clock-bottom');
    if (clockTop && clockBottom) {
        (isFlipped ? clockTop : clockBottom).textContent = format(whiteTime);
        (isFlipped ? clockBottom : clockTop).textContent = format(blackTime);
    }
}

function jumpToMoveIndex(idx) {
    if (idx < 0 || idx > fullMoveHistory.length) return;
    currentMoveIndex = idx;
    displayGame = new Chess();
    for (let i = 0; i < currentMoveIndex; i++) {
        displayGame.move(fullMoveHistory[i]);
    }
    selectedSquare = null; 
    validMoves = [];
    renderBoard(false); 
    updateMoveLog();
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

function clearSelection() { selectedSquare = null; validMoves = []; renderBoard(false); }

async function getUserName(uid) {
    if (!uid) return "Игрок";
    try {
        const snap = await getDoc(doc(db, "users", uid));
        return snap.exists() ? snap.data().username : "Игрок";
    } catch (e) {
        return "Игрок";
    }
}

function parseTimeControl(tc) {
    if (tc === 'none') return { time: 999999, inc: 0 };
    const parts = tc.split('+');
    return {
        time: parseInt(parts[0]) * 60,
        inc: parseInt(parts[1]) || 0
    };
}

function startSearchTimer() {
    searchSeconds = 0;
    const el = document.getElementById('search-timer');
    if (el) el.textContent = `Вы в очереди: 0 сек`;
    
    searchSeconds++;
    searchTimerInterval = setInterval(() => {
        if (el) el.textContent = `Вы в очереди: ${searchSeconds} сек`;
        searchSeconds++;
    }, 1000);
}

function stopSearchTimer() {
    if (searchTimerInterval) clearInterval(searchTimerInterval);
    searchTimerInterval = null;
}

function applyGlobalSettings() {
    try {
        const boardEl = document.getElementById('board');
        if (!boardEl) return;

        const theme = localStorage.getItem('azachess-setting-theme') || 'emerald';
        const coords = localStorage.getItem('azachess-setting-coords') !== 'false';

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
