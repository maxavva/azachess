import { auth, onAuthStateChanged } from "./firebase-logic.js";

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
let moveHistoryTree = { id: 0, parent: null, move: null, children: [] };
let activeNode = moveHistoryTree;

let selectedSquare = null, validMoves = [], isFlipped = false;
let isDragging = false, dragStartX = 0, dragStartY = 0, dragClone = null, draggedPieceImg = null, draggedSquare = null, dragMovedEnough = false;
let promotionFrom = null, promotionTo = null;

// ФУНКЦИЯ ИНИЦИАЛИЗАЦИИ
function initAnalysis() {
    const uid = localStorage.getItem('azachess-user-id');
    if (!uid || uid === "null") {
        window.location.href = 'auth.html';
        return;
    }

    // Привязка кнопок
    document.getElementById('btn-new-game').onclick = startNewGame;
    document.getElementById('btn-flip').onclick = flipBoard;
    document.getElementById('btn-nav-first').onclick = () => jumpToMoveNode(moveHistoryTree);
    document.getElementById('btn-nav-prev').onclick = navigatePrev;
    document.getElementById('btn-nav-next').onclick = navigateNext;
    document.getElementById('btn-nav-last').onclick = navigateLast;

    window.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowLeft') { e.preventDefault(); navigatePrev(); }
        if (e.key === 'ArrowRight') { e.preventDefault(); navigateNext(); }
    });

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
        } catch (e) { console.error(e); }
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

// --- ЛОГИКА ДОСКИ (Остается прежней, но убедись, что она внутри этого файла) ---
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
        const name = sq.dataset.square, piece = game.get(name);
        sq.classList.remove('last-move', 'selected', 'check');
        if (activeNode.move && (name === activeNode.move.from || name === activeNode.move.to)) sq.classList.add('last-move');
        if (selectedSquare === name) sq.classList.add('selected');
        if (game.in_check() && piece?.type === 'k' && piece.color === game.turn()) sq.classList.add('check');
        
        let img = sq.querySelector('.piece');
        if (piece) {
            if (!img) { img = document.createElement('img'); img.className = 'piece'; img.draggable = false; sq.appendChild(img); }
            img.src = pieceImagePaths[`${piece.color}${piece.type.toUpperCase()}`];
        } else if (img) sq.removeChild(img);
        
        let m = sq.querySelector('.move-dest, .move-dest-capture');
        if (validMoves.includes(name)) {
            const cls = piece ? 'move-dest-capture' : 'move-dest';
            if (!m || m.className !== cls) { if (m) sq.removeChild(m); m = document.createElement('div'); m.className = cls; sq.appendChild(m); }
        } else if (m) sq.removeChild(m);
    });
}

function handlePointerDown(e, sq) {
    if (typeof window.unlockAudio === 'function') window.unlockAudio();

    // 1. ЕСЛИ УЖЕ ВЫБРАН КВАДРАТ И МЫ КЛИКАЕМ ПО ДОПУСТИМОМУ ХОДУ -> ХОД ЩЕЛЧКОМ
    if (selectedSquare && validMoves.includes(sq)) {
        const move = game.moves({ square: selectedSquare, verbose: true }).find(m => m.to === sq);
        if (move?.flags.includes('p')) {
            promotionFrom = selectedSquare; promotionTo = sq;
            document.getElementById('promotion-modal').classList.remove('hidden');
            renderPromotionChoices();
        } else {
            executeAnalysisMove(selectedSquare, sq);
        }
        return;
    }

    // 2. ВЫБОР ФИГУРЫ И НАЧАЛО ПЕРЕТАСКИВАНИЯ
    const piece = game.get(sq);
    if (piece) {
        selectedSquare = sq;
        validMoves = game.moves({ square: sq, verbose: true }).map(m => m.to);
        
        isDragging = true;
        draggedSquare = sq;
        dragStartX = e.clientX;
        dragStartY = e.clientY;
        draggedPieceImg = e.target.classList.contains('piece') ? e.target : e.target.querySelector('.piece');
        
        renderBoard(false); // Рисуем точки ходов сразу после нажатия
        
        window.onpointermove = handlePointerMove;
        window.onpointerup = handlePointerUp;
    } else {
        clearSelection();
    }
}

function handlePointerMove(e) {
    if (!isDragging || !draggedPieceImg) return;
    
    // Проверяем, сдвинулся ли палец/мышь достаточно далеко
    if (Math.hypot(e.clientX - dragStartX, e.clientY - dragStartY) > 5) {
        dragMovedEnough = true;
        
        if (!dragClone) {
            dragClone = draggedPieceImg.cloneNode(true);
            dragClone.className = 'piece drag-clone';
            
            // Задаем размер клона точно такой же, как у оригинала
            const rect = draggedPieceImg.getBoundingClientRect();
            dragClone.style.width = rect.width + "px";
            dragClone.style.height = rect.height + "px";
            
            document.body.appendChild(dragClone);
            draggedPieceImg.style.visibility = 'hidden'; // Скрываем оригинал на доске
        }
        
        dragClone.style.left = (e.clientX - dragClone.offsetWidth / 2) + 'px';
        dragClone.style.top = (e.clientY - dragClone.offsetHeight / 2) + 'px';
    }
}

function handlePointerUp(e) {
    isDragging = false;
    window.onpointermove = null;
    window.onpointerup = null;

    if (dragClone) {
        document.body.removeChild(dragClone);
        dragClone = null;
    }
    if (draggedPieceImg) draggedPieceImg.style.visibility = 'visible';

    const target = document.elementFromPoint(e.clientX, e.clientY)?.closest('.square')?.dataset.square;

    // Если мы реально тащили фигуру и бросили на валидный квадрат
    if (dragMovedEnough && target && validMoves.includes(target)) {
        const move = game.moves({ square: draggedSquare, verbose: true }).find(m => m.to === target);
        if (move?.flags.includes('p')) {
            promotionFrom = draggedSquare; promotionTo = target;
            document.getElementById('promotion-modal').classList.remove('hidden');
            renderPromotionChoices();
        } else {
            executeAnalysisMove(draggedSquare, target);
        }
    } else if (!dragMovedEnough) {
        // Если это был просто короткий клик — ничего не сбрасываем, оставляем выбор
    } else {
        // Если тащили, но бросили мимо
        renderBoard(false);
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
    selectedSquare = null; validMoves = [];
    renderBoard(true); updateMoveLog(); updateStatus();
}

function jumpToMoveNode(node) {
    if (!node) return;
    activeNode = node;
    const path = []; let temp = node;
    while (temp && temp.move) { path.push(temp.move); temp = temp.parent; }
    game = new Chess();
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

function navigatePrev() { if (activeNode.parent) jumpToMoveNode(activeNode.parent); }
function navigateNext() { if (activeNode.children.length > 0) jumpToMoveNode(activeNode.children[0]); }
function navigateLast() { let t = activeNode; while(t.children.length > 0) t = t.children[0]; jumpToMoveNode(t); }
function startNewGame() { game = new Chess(); moveHistoryTree = { id:0, parent:null, move:null, children:[] }; activeNode = moveHistoryTree; finalizeMove(); }
function flipBoard() { isFlipped = !isFlipped; renderBoard(true); }
function clearSelection() { selectedSquare = null; validMoves = []; renderBoard(false); }
function updateStatus() { document.getElementById('status-text').textContent = game.in_checkmate() ? "Мат!" : "Свободный анализ"; }
