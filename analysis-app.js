import { auth, onAuthStateChanged } from "./firebase-logic.js";
import { initSettings } from "./settings.js";

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

var game = new Chess();
window.game = game; // Синхронизируем со звуковым движком сразу при старте

let moveHistoryTree = { id: 0, parent: null, move: null, children: [] };
let activeNode = moveHistoryTree;

let selectedSquare = null, validMoves = [], isFlipped = false;
let isDragging = false, dragStartX = 0, dragStartY = 0, dragClone = null, draggedPieceImg = null, draggedSquare = null, dragMovedEnough = false;
let promotionFrom = null, promotionTo = null;

// ФУНКЦИЯ ИНИЦИАЛИЗАЦИИ
function initAnalysis() {
    initSettings(() => renderBoard(true));
    const uid = localStorage.getItem('azachess-user-id');
    if (!uid || uid === "null") {
        window.location.href = 'auth.html';
        return;
    }

    // Привязка кнопок
    const setup = (id, fn) => { const el = document.getElementById(id); if (el) el.onclick = fn; };
    setup('btn-new-game', startNewGame);
    setup('btn-flip', flipBoard);
    setup('btn-nav-first', () => jumpToMoveNode(moveHistoryTree));
    setup('btn-nav-prev', navigatePrev);
    setup('btn-nav-next', navigateNext);
    setup('btn-nav-last', navigateLast);

    // Защита от дублирования обработчиков клавиатуры
    if (!window.azachessAnalysisKeydownAttached) {
        window.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowLeft') { e.preventDefault(); navigatePrev(); }
            if (e.key === 'ArrowRight') { e.preventDefault(); navigateNext(); }
        });
        window.azachessAnalysisKeydownAttached = true;
    }

    // ПРОВЕРКА ЗАГРУЗКИ ИЗ АРХИВА
    const loadData = sessionStorage.getItem('analysis-load-game');
    if (loadData) {
        try {
            const moves = JSON.parse(loadData);
            moves.forEach(m => {
                const res = game.move(m);
                if (res) {
                    let child = { id: Math.random(), parent: activeNode, move: res, children: [] };
                    activeNode.children.push(child);
                    activeNode = child;
                }
            });
            sessionStorage.removeItem('analysis-load-game');
        } catch (e) { 
            console.error("Ошибка парсинга загруженной партии:", e); 
        }
    }

    renderBoard(true);
    updateMoveLog();
    updateStatus();
}

// Запуск
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAnalysis);
} else {
    initAnalysis();
}

// --- ЛОГИКА ДОСКИ ---
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
        const name = sq.dataset.square, piece = game.get(name);
        sq.classList.remove('last-move', 'selected', 'check');
        if (activeNode.move && (name === activeNode.move.from || name === activeNode.move.to)) sq.classList.add('last-move');
        if (selectedSquare === name) sq.classList.add('selected');
        if (game.in_check() && piece?.type === 'k' && piece.color === game.turn()) sq.classList.add('check');
        
        let img = sq.querySelector('.piece');
        if (piece) {
            if (!img) { 
                img = document.createElement('img'); 
                img.className = 'piece'; 
                img.draggable = false; 
                sq.appendChild(img); 
            }
            img.src = pieceImagePaths[`${piece.color}${piece.type.toUpperCase()}`];
        } else if (img) sq.removeChild(img);
        
        let m = sq.querySelector('.move-dest, .move-dest-capture');
        
        // Показываем подсказки в зависимости от настроек
        if (showHints && validMoves.includes(name)) {
            const cls = piece ? 'move-dest-capture' : 'move-dest';
            if (!m || m.className !== cls) { 
                if (m) sq.removeChild(m); 
                m = document.createElement('div'); 
                m.className = cls; 
                sq.appendChild(m); 
            }
        } else if (m) sq.removeChild(m);
    });
}
function handlePointerDown(e, sq) {
    if (typeof window.unlockAudio === 'function') window.unlockAudio();

    // 1. Если кликаем по подсвеченному квадрату (уже выбрали фигуру до этого)
    if (selectedSquare && validMoves.includes(sq)) {
        completeMove(selectedSquare, sq);
        return;
    }

    // 2. Если кликаем по фигуре
    const piece = game.get(sq);
    if (piece) {
        // Выбираем фигуру (подсвечиваем ходы)
        selectedSquare = sq;
        validMoves = game.moves({ square: sq, verbose: true }).map(m => m.to);
        
        // Подготовка к возможному перетаскиванию
        isDragging = true;
        draggedSquare = sq;
        dragStartX = e.clientX;
        dragStartY = e.clientY;
        dragMovedEnough = false;
        draggedPieceImg = e.target.classList.contains('piece') ? e.target : e.target.querySelector('.piece');
        
        renderBoard(false); // Сразу показываем точки ходов

        window.onpointermove = handlePointerMove;
        window.onpointerup = handlePointerUp;
        
        // Важно для мобилок: захватываем указатель
        try { e.target.setPointerCapture(e.pointerId); } catch(err) {}
    } else {
        // Клик по пустому месту (не ходу) — сброс
        clearSelection();
    }
}

function handlePointerMove(e) {
    if (!isDragging || !draggedPieceImg) return;

    const dist = Math.hypot(e.clientX - dragStartX, e.clientY - dragStartY);
    
    // Если сдвинули палец/мышь больше чем на 5 пикселей — включаем режим перетаскивания
    if (dist > 5) {
        dragMovedEnough = true;
        
        if (!dragClone) {
            dragClone = draggedPieceImg.cloneNode(true);
            dragClone.className = 'piece drag-clone';
            const rect = draggedPieceImg.getBoundingClientRect();
            dragClone.style.width = rect.width + "px";
            dragClone.style.height = rect.height + "px";
            document.body.appendChild(dragClone);
            draggedPieceImg.style.visibility = 'hidden';
        }
        
        dragClone.style.left = (e.clientX - dragClone.offsetWidth / 2) + 'px';
        dragClone.style.top = (e.clientY - dragClone.offsetHeight / 2) + 'px';
    }
}

function handlePointerUp(e) {
    if (!isDragging) return;
    
    const wasDragging = dragMovedEnough;
    isDragging = false;
    window.onpointermove = null;
    window.onpointerup = null;

    // Безопасно освобождаем pointer capture на мобильных устройствах
    try { e.target.releasePointerCapture(e.pointerId); } catch(err) {}

    if (dragClone) {
        document.body.removeChild(dragClone);
        dragClone = null;
    }
    if (draggedPieceImg) draggedPieceImg.style.visibility = 'visible';

    // Находим, над каким квадратом отпустили
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const targetSq = el?.closest('.square')?.dataset.square;

    if (wasDragging) {
        // Если реально тащили и бросили на нужный квадрат — делаем ход
        if (targetSq && validMoves.includes(targetSq)) {
            completeMove(draggedSquare, targetSq);
        } else {
            // Если бросили мимо — просто перерисовываем (выбор останется)
            renderBoard(false);
        }
    }
    
    dragMovedEnough = false;
}

function executeAnalysisMove(f, t, p = 'q') {
    const res = game.move({ from: f, to: t, promotion: p });
    if (res) {
        if (window.playMoveSound) window.playMoveSound(res);
        let child = activeNode.children.find(c => c.move.san === res.san);
        if (!child) {
            child = { id: Math.random(), parent: activeNode, move: res, children: [] };
            activeNode.children.push(child);
        }
        activeNode = child;
        finalizeMove();
    }
}

function finalizeMove() {
    selectedSquare = null; 
    validMoves = [];
    renderBoard(true); 
    updateMoveLog(); 
    updateStatus();
}

function jumpToMoveNode(node) {
    if (!node) return;
    activeNode = node;
    const path = []; let temp = node;
    while (temp && temp.move) { path.push(temp.move); temp = temp.parent; }
    
    game = new Chess();
    window.game = game; // Поддерживаем связь с глобальной переменной для звукового движка
    
    path.reverse().forEach(m => game.move(m));
    finalizeMove();
}

function updateMoveLog() {
    const log = document.getElementById('move-log'); if (!log) return; log.innerHTML = '';
    const path = []; let t = activeNode; while (t && t.move) { path.push(t); t = t.parent; } path.reverse();
    let forward = activeNode; while (forward.children.length > 0) { forward = forward.children[0]; path.push(forward); }

    for (let i = 0; i < path.length; i += 2) {
        const row = document.createElement('div'); row.className = 'move-row';
        const w = path[i], b = path[i+1], num = Math.floor(i/2)+1;
        
        const wSpan = document.createElement('span');
        wSpan.className = `move-text ${w.id === activeNode.id ? 'active-move' : ''}`;
        wSpan.textContent = w.move.san;
        wSpan.onclick = () => jumpToMoveNode(w);

        row.innerHTML = `<span style="color:#666;">${num}.</span>`;
        row.appendChild(wSpan);

        if (b) {
            const bSpan = document.createElement('span');
            bSpan.className = `move-text ${b.id === activeNode.id ? 'active-move' : ''}`;
            bSpan.textContent = b.move.san;
            bSpan.onclick = () => jumpToMoveNode(b);
            row.appendChild(bSpan);
        }
        log.appendChild(row);
    }
    updateBranchSelector();
}

function updateBranchSelector() {
    const panel = document.getElementById('branch-panel'), container = document.getElementById('branch-choices');
    if (!panel || !container) return;
    const choices = (activeNode.parent && activeNode.parent.children.length > 1) ? activeNode.parent.children : [];
    if (choices.length > 1) {
        panel.style.display = 'block'; container.innerHTML = '';
        choices.forEach(c => {
            const btn = document.createElement('button');
            btn.className = `branch-btn ${c.id === activeNode.id ? 'active-branch' : ''}`;
            btn.textContent = c.move.san; btn.onclick = () => jumpToMoveNode(c);
            container.appendChild(btn);
        });
    } else panel.style.display = 'none';
}

function renderPromotionChoices() {
    const container = document.querySelector('.promotion-choices');
    const turn = game.turn(); container.innerHTML = '';
    ['q','r','b','n'].forEach(p => {
        const btn = document.createElement('button');
        btn.innerHTML = `<img src="${pieceImagePaths[turn+p.toUpperCase()]}" style="width:100%">`;
        btn.onclick = () => { 
            executeAnalysisMove(promotionFrom, promotionTo, p); 
            document.getElementById('promotion-modal').classList.add('hidden'); 
        };
        container.appendChild(btn);
    });
}

function completeMove(from, to) {
    const move = game.moves({ square: from, verbose: true }).find(m => m.to === to);
    if (move?.flags.includes('p')) {
        promotionFrom = from; 
        promotionTo = to;
        document.getElementById('promotion-modal').classList.remove('hidden');
        renderPromotionChoices();
    } else {
        executeAnalysisMove(from, to);
    }
}

function navigatePrev() { if (activeNode.parent) jumpToMoveNode(activeNode.parent); }
function navigateNext() { if (activeNode.children.length > 0) jumpToMoveNode(activeNode.children[0]); }
function navigateLast() { let t = activeNode; while(t.children.length > 0) t = t.children[0]; jumpToMoveNode(t); }

function startNewGame() { 
    game = new Chess(); 
    window.game = game; // Синхронизируем глобальную переменную
    moveHistoryTree = { id: 0, parent: null, move: null, children: [] }; 
    activeNode = moveHistoryTree; 
    finalizeMove(); 
}

function flipBoard() { isFlipped = !isFlipped; renderBoard(true); }
function clearSelection() { selectedSquare = null; validMoves = []; renderBoard(false); }
function updateStatus() { document.getElementById('status-text').textContent = game.in_checkmate() ? "Мат!" : "Свободный анализ"; }

function applyGlobalSettings() {
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
}
