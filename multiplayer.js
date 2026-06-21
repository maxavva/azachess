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

// Безопасный оборонительный биндинг кликов
const bindClick = (id, fn) => {
    const el = document.getElementById(id);
    if (el) {
        el.onclick = fn;
        console.log(`[Azachess-PvP] Обработчик клика для '${id}' успешно привязан.`);
    } else {
        console.warn(`[Azachess-PvP] Предупреждение: Кнопка с ID '${id}' не найдена в разметке HTML.`);
    }
};

// Инициализация PvP арены
function initMultiplayer() {
    console.log("[Azachess-PvP] Запуск инициализации скрипта...");
    try {
        const uid = localStorage.getItem('azachess-user-id');
        if (!uid || uid === "null") {
            console.warn("[Azachess-PvP] Пользователь не авторизован, перенаправление...");
            window.location.href = 'auth.html';
            return;
        }

        applyGlobalSettings();
        setupTimeControlPvP();

        // Безопасная привязка лобби-кнопок
        bindClick('btn-start-search', startMatchmaking);
        bindClick('btn-invite-friend', createInviteRoom);
        bindClick('btn-cancel-search', cancelMatchmaking);

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

        // Проверка входящего вызова по ссылке (?room=ID)
        checkInviteQuery();
        console.log("[Azachess-PvP] Инициализация завершена без ошибок.");
    } catch (e) {
        console.error("[Azachess-PvP] Ошибка во время инициализации лобби:", e);
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initMultiplayer);
} else {
    initMultiplayer();
}

// Управление экранами с защитой от отсутствия элементов
function showView(view) {
    const views = ['lobby-view', 'searching-view', 'invite-view', 'game-view'];
    views.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.add('hidden');
    });

    const activeEl = document.getElementById(`${view}-view`);
    if (activeEl) activeEl.classList.remove('hidden');

    const header = document.getElementById('multiplayer-header');
    if (header) {
        if (view === 'lobby') header.textContent = "Онлайн PvP-Арена";
        else if (view === 'searching') header.textContent = "Поиск игры";
        else if (view === 'invite') header.textContent = "Вызов друга";
    }
}

// Выбор времени в PvP
function setupTimeControlPvP() {
    const items = document.querySelectorAll('#time-grid-pvp .grid-item');
    if (items.length === 0) {
        console.warn("[Azachess-PvP] Элементы сетки времени #time-grid-pvp не обнаружены.");
        return;
    }
    items.forEach(el => {
        el.onclick = () => {
            items.forEach(i => i.classList.remove('active'));
            el.classList.add('active');
            selectedTimeControl = el.dataset.time;
            console.log("[Lobby] Выбран контроль времени:", selectedTimeControl);
        };
    });
}

// Запуск подбора (Матчмейкинг v2 - Точечный)
async function startMatchmaking() {
    const userId = localStorage.getItem('azachess-user-id');
    const username = await getUserName(userId);
    const timeControl = selectedTimeControl;

    console.log(`[Matchmaker] Поиск запущен. Игрок: ${username} (${userId}), контроль: ${timeControl}`);
    showView('searching');
    startSearchTimer();

    try {
        // 1. Ищем свободного игрока в очереди
        const qRef = collection(db, "queue");
        const q = query(qRef, where("timeControl", "==", timeControl), limit(10));
        const snap = await getDocs(q);

        console.log(`[Matchmaker] Найдено кандидатов в коллекции queue: ${snap.size}`);

        // Фильтруем тех, кто еще не соединен, и сортируем по времени создания локально в памяти
        const sortedDocs = snap.docs
            .filter(d => d.id !== userId && !d.data().matchedGameId)
            .sort((a, b) => (a.data().createdAt || 0) - (b.data().createdAt || 0));

        console.log(`[Matchmaker] Свободных оппонентов после фильтрации: ${sortedDocs.length}`);

        let matchFound = false;
        let matchedGameId = null;

        for (let candidateDoc of sortedDocs) {
            const candidate = candidateDoc.data();
            console.log(`[Matchmaker] Пробуем соединиться с кандидатом: ${candidate.username}`);

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

                if (matchFound) {
                    console.log(`[Matchmaker] Успешное сопоставление! Создана комната: ${matchedGameId}`);
                    break;
                }
            } catch (txErr) {
                console.warn("[Matchmaker] Ошибка транзакции (возможно, конкурентный перехват):", txErr);
            }
        }

        if (matchFound) {
            stopSearchTimer();
            joinRoom(matchedGameId);
        } else {
            console.log("[Matchmaker] Подходящих оппонентов не найдено. Создаем свой билет в очереди...");
            // 2. Если никого нет в очереди, добавляем себя и подписываемся на СВОЙ ДОКУМЕНТ ОЧЕРЕДИ
            const myQueueRef = doc(db, "queue", userId);
            await setDoc(myQueueRef, {
                userId,
                username,
                timeControl,
                matchedGameId: null,
                createdAt: Date.now()
            });

            console.log(`[Matchmaker] Билет создан. Подписываемся на обновление /queue/${userId}`);

            queueListener = onSnapshot(myQueueRef, (docSnap) => {
                if (docSnap.exists()) {
                    const queueData = docSnap.data();
                    if (queueData.matchedGameId) {
                        console.log(`[Matchmaker] Оппонент подключился к нам! ID комнаты: ${queueData.matchedGameId}`);
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
        console.error("[Matchmaker] Критическая ошибка при подборе:", err);
        alert("Произошла ошибка подбора.");
        cancelMatchmaking();
    }
}

// Отмена поиска
async function cancelMatchmaking() {
    console.log("[Matchmaker] Поиск отменен пользователем.");
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

// Проверка входящего подключения по ссылке
async function checkInviteQuery() {
    const urlParams = new URLSearchParams(window.location.search);
    const roomId = urlParams.get('room');
    if (!roomId) {
        showView('lobby');
        return;
    }

    const userId = localStorage.getItem('azachess-user-id');
    if (!userId || userId === "null") {
        console.log("[Invite] Отложенный вход: сохраняем комнату в кэш и уводим на авторизацию");
        localStorage.setItem('azachess-join-room-after-auth', roomId);
        window.location.href = 'auth.html';
        return;
    }

    console.log(`[Invite] Обнаружен переход по ссылке вызова. Комната: ${roomId}`);
    const gameRef = doc(db, "pvp_games", roomId);

    try {
        const gameSnap = await getDoc(gameRef);
        if (!gameSnap.exists()) {
            alert("Данный вызов не существует или был отменен.");
            window.location.href = 'multiplayer.html';
            return;
        }

        const gameData = gameSnap.data();

        // Если игра уже идет
        if (gameData.status === 'active') {
            if (userId === gameData.whiteId || userId === gameData.blackId) {
                joinRoom(roomId);
            } else {
                alert("В этой комнате уже играют двое.");
                window.location.href = 'multiplayer.html';
            }
            return;
        }

        if (gameData.status !== 'waiting') {
            alert("Этот матч уже завершен.");
            window.location.href = 'multiplayer.html';
            return;
        }

        // Подключаемся к комнате ожидания (status === 'waiting')
        const userStats = await getUserStats(userId);
        const username = userStats.username;

        await runTransaction(db, async (transaction) => {
            const txSnap = await transaction.get(gameRef);
            const data = txSnap.data();

            if (data.status !== 'waiting') {
                throw "Комната уже заполнена.";
            }

            const updates = {
                status: "active",
                lastMoveTime: Date.now()
            };

            // Занимаем свободное кресло
            if (data.whiteId === null) {
                updates.whiteId = userId;
                updates.whiteName = username;
            } else if (data.blackId === null) {
                updates.blackId = userId;
                updates.blackName = username;
            }

            transaction.update(gameRef, updates);
        });

        console.log("[Invite] Успешно подключились к вызову друга!");
        joinRoom(roomId);

    } catch (err) {
        console.error("Ошибка при входе в вызов:", err);
        alert(`Не удалось войти в игру. Код ошибки:\n${err}`);
        window.location.href = 'multiplayer.html';
    }
}

// Создание вызова по ссылке (Сыграть с другом)
async function createInviteRoom() {
    const userId = localStorage.getItem('azachess-user-id');
    const userStats = await getUserStats(userId);
    const username = userStats.username;
    const timeControl = selectedTimeControl;

    console.log(`[Invite] Создание комнаты вызова... Контроль: ${timeControl}`);

    try {
        const gameId = doc(collection(db, "pvp_games")).id;
        const gameRef = doc(db, "pvp_games", gameId);

        // Рандомизируем цвета для создателя
        const creatorIsWhite = Math.random() > 0.5;

        const baseTime = parseTimeControl(timeControl).time;
        const increment = parseTimeControl(timeControl).inc;

        const gameData = {
            id: gameId,
            whiteId: creatorIsWhite ? userId : null,
            whiteName: creatorIsWhite ? username : "Ожидание соперника...",
            blackId: creatorIsWhite ? null : userId,
            blackName: creatorIsWhite ? "Ожидание соперника..." : username,
            timeControl: timeControl,
            fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
            history: [],
            turn: "w",
            whiteTime: baseTime,
            blackTime: baseTime,
            increment: increment,
            lastMoveTime: Date.now(),
            status: "waiting", // Выставляем статус ожидания
            winner: null,
            createdAt: Date.now()
        };

        await setDoc(gameRef, gameData);

        // Формируем ссылку и выводим её в Input
        const inviteUrl = `${window.location.origin}${window.location.pathname}?room=${gameId}`;
        const linkInput = document.getElementById('invite-link-input');
        if (linkInput) linkInput.value = inviteUrl;

        // Копирование в буфер
        const copyBtn = document.getElementById('btn-copy-link');
        if (copyBtn) {
            copyBtn.onclick = () => {
                navigator.clipboard.writeText(inviteUrl);
                copyBtn.innerText = "Скопировано!";
                setTimeout(() => { copyBtn.innerText = "Копировать"; }, 1500);
            };
        }

        // Отмена вызова
        bindClick('btn-cancel-invite', async () => {
            if (gameListener) { gameListener(); gameListener = null; }
            await deleteDoc(gameRef).catch(() => {});
            showView('lobby');
        });

        showView('invite');

        // Слушаем, когда друг зайдет в созданную комнату
        gameListener = onSnapshot(gameRef, (docSnap) => {
            if (docSnap.exists()) {
                const data = docSnap.data();
                if (data.status === 'active') {
                    if (gameListener) gameListener();
                    gameListener = null;
                    joinRoom(gameId);
                }
            }
        });

    } catch (err) {
        console.error("Ошибка вызова друга:", err);
        alert("Не удалось сформировать ссылку вызова.");
    }
}

// Подключение к комнате
function joinRoom(gameId) {
    currentGameId = gameId;
    const userId = localStorage.getItem('azachess-user-id');

    console.log(`[Room] Подключение к игровой комнате: ${gameId}`);
    showView('game');

    const gameRef = doc(db, "pvp_games", gameId);
    gameListener = onSnapshot(gameRef, (docSnap) => {
        if (!docSnap.exists()) {
            console.warn("[Room] Комната не найдена или удалена сервером.");
            alert("Игра завершена или удалена.");
            leaveRoom();
            return;
        }

        const data = docSnap.data();
        
        // Роль игрока
        if (userId === data.whiteId) currentRole = 'w';
        else if (userId === data.blackId) currentRole = 'b';
        else currentRole = 'spectator';

        console.log(`[Room] Синхронизация данных. Ваша роль: ${currentRole}`);

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

// Обновление игрового статуса
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

// Сохранение PvP игры в личный архив и обновление простой статистики (без ELO)
async function saveOnlineGameToArchive(data) {
    const userId = localStorage.getItem('azachess-user-id');
    if (!userId || data.history.length < 2) return;

    const archiveKey = `pvp-archived-${data.id}`;
    if (localStorage.getItem(archiveKey)) return;

    localStorage.setItem(archiveKey, "true");

    let statusReason = "Игра окончена";
    let outcome = 0.5; // По умолчанию ничья

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

    // 1. Считываем текущую простую статистику игрока
    const stats = await getUserStats(userId);

    // 2. Формируем новые показатели (простые инкременты)
    const newWins = stats.wins + (outcome === 1 ? 1 : 0);
    const newLosses = stats.losses + (outcome === 0 ? 1 : 0);
    const newDraws = stats.draws + (outcome === 0.5 ? 1 : 0);
    const newPlayed = stats.gamesPlayed + 1;

    // 3. Записываем обновленные поля в Firestore профиля
    try {
        await setDoc(doc(db, "users", userId), {
            wins: newWins,
            losses: newLosses,
            draws: newDraws,
            gamesPlayed: newPlayed
        }, { merge: true });
        console.log(`[Profile] Статистика успешно сохранена. Сыграно: ${newPlayed}`);
    } catch (err) {
        console.error("Ошибка обновления статистики в профиле:", err);
    }

    // 4. Записываем игру в личную историю в кэш и облако
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

    const archive = JSON.parse(localStorage.getItem('azachess-archive') || '[]');
    archive.unshift(gameData);
    localStorage.setItem('azachess-archive', JSON.stringify(archive));

    try {
        const userHistoryRef = doc(db, "users", userId, "history", data.id);
        await setDoc(userHistoryRef, gameData);
        console.log("[Room] Партия успешно заархивирована в Firestore.");
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

// Клики и перетаскивание фигур (Pointer Events с захватом для тач-скринов)
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

        // Позволяет захватить палец на тач-экранах смартфонов (предотвращает скролл и срыв фигуры)
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

    // Освобождаем захват указателя для тач-скринов
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

// Сброс и перезапуск
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
