/**
 * AZACHESS - Analysis Mode Engine
 */

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
let stockfishWorker = null, isStockfishReady = false, analysisLines = [];
let promotionFrom = null, promotionTo = null;

document.addEventListener('DOMContentLoaded', () => {
    initStockfish();
    
    // ПРОВЕРКА ЗАГРУЗКИ ИЗ АРХИВА
    const loadData = sessionStorage.getItem('analysis-load-game');
    if (loadData) {
        try {
            const moves = JSON.parse(loadData);
            game = new Chess();
            moveHistoryTree = { id: 0, parent: null, move: null, children: [] };
            activeNode = moveHistoryTree;

            moves.forEach(m => {
                const res = game.move(m);
                if (res) {
                    let child = { id: Math.random(), parent: activeNode, move: res, children: [] };
                    activeNode.children.push(child);
                    activeNode = child;
                }
            });
            sessionStorage.removeItem('analysis-load-game'); // Очищаем после загрузки
        } catch (e) { console.error("Archive Load Error:", e); }
    }

    renderBoard(true);
    updateMoveLog();
    updateStatus();

    // Кнопки
    document.getElementById('btn-new-game').onclick = startNewGame;
    document.getElementById('btn-flip').onclick = flipBoard;
    document.getElementById('btn-nav-first').onclick = () => jumpToMoveNode(moveHistoryTree);
    document.getElementById('btn-nav-prev').onclick = navigatePrev;
    document.getElementById('btn-nav-next').onclick = navigateNext;
    document.getElementById('btn-nav-last').onclick = navigateLast;

    // Клавиатура
    window.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowLeft') { e.preventDefault(); navigatePrev(); }
        if (e.key === 'ArrowRight') { e.preventDefault(); navigateNext(); }
    });

    const engineToggle = document.getElementById('engine-toggle');
    if (engineToggle) engineToggle.onchange = runAnalysisTask;
});

// --- СИСТЕМА ДВИЖКА ---
function initStockfish() {
    try {
        const blobCode = `importScripts('https://cdnjs.cloudflare.com/ajax/libs/stockfish.js/10.0.2/stockfish.js');`;
        stockfishWorker = new Worker(URL.createObjectURL(new Blob([blobCode], { type: 'application/javascript' })));
        stockfishWorker.onmessage = (e) => {
            if (e.data === 'readyok') { isStockfishReady = true; runAnalysisTask(); }
            if (e.data.startsWith('info')) handleAnalysisData(e.data);
        };
        stockfishWorker.postMessage('uci');
        stockfishWorker.postMessage('isready');
    } catch (err) { console.error(err); }
}

function handleAnalysisData(data) {
    const multipvMatch = data.match(/multipv (\d+)/);
    const pvIndex = multipvMatch ? parseInt(multipvMatch[1]) - 1 : 0;
    let score = "0.00";
    
    if (data.includes('score cp')) {
        let cp = parseInt(data.match(/score cp (-?\d+)/)[1]);
        if (game.turn() === 'b') cp = -cp;
        score = (cp / 100).toFixed(2);
        if (pvIndex === 0) updateEvaluationBar(cp);
    } else if (data.includes('score mate')) {
        score = "M" + Math.abs(data.match(/score mate (-?\d+)/)[1]);
    }

    const pvMatch = data.match(/ pv (.+)/);
    if (pvMatch) {
        const pvMoves = pvMatch[1].split(' ');
        analysisLines[pvIndex] = { score, move: pvMoves[0].substring(0,2)+"→"+pvMoves[0].substring(2,4), path: pvMoves.slice(1, 4).join(' ') };
        renderMultiPV();
    }
}

function runAnalysisTask() {
    if (!isStockfishReady) return;
    
    // Настройки теперь жестко заданы или берутся из логики, а не из HTML
    const multiPV = 3; // Всегда анализируем 3 лучшие линии
    const threads = 4;  // Используем 4 ядра (оптимально для большинства)

    stockfishWorker.postMessage('stop');
    analysisLines = [];
    
    stockfishWorker.postMessage(`setoption name MultiPV value ${multiPV}`);
    stockfishWorker.postMessage(`setoption name Threads value ${threads}`);
    stockfishWorker.postMessage(`position fen ${game.fen()}`);
    stockfishWorker.postMessage('go depth 18');
}

// --- ВИЗУАЛИЗАЦИЯ И ДОСКА ---
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
    if (selectedSquare && validMoves.includes(sq)) {
        const move = game.moves({ square: selectedSquare, verbose: true }).find(m => m.to === sq);
        if (move?.flags.includes('p')) {
            promotionFrom = selectedSquare; promotionTo = sq;
            document.getElementById('promotion-modal').classList.remove('hidden');
            renderPromotionChoices();
        } else executeAnalysisMove(selectedSquare, sq);
        return;
    }
    const piece = game.get(sq);
    if (piece) {
        isDragging = true; draggedSquare = sq; dragStartX = e.clientX; dragStartY = e.clientY;
        draggedPieceImg = e.target.classList.contains('piece') ? e.target : e.target.querySelector('.piece');
        if (piece.color === game.turn()) { selectedSquare = sq; validMoves = game.moves({ square: sq, verbose: true }).map(m => m.to); }
        else { selectedSquare = null; validMoves = []; }
        renderBoard(false);
        window.onpointermove = handlePointerMove; window.onpointerup = handlePointerUp;
    } else clearSelection();
}

function handlePointerMove(e) {
    if (!isDragging || !draggedPieceImg) return;
    if (Math.hypot(e.clientX - dragStartX, e.clientY - dragStartY) > 5) {
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
    if (dragMovedEnough && target && validMoves.includes(target)) {
        handlePointerDown({ clientX: e.clientX, clientY: e.clientY }, target);
    } else if (dragMovedEnough) renderBoard(false);
    dragMovedEnough = false;
}

function executeAnalysisMove(f, t, p = 'q') {
    const res = game.move({ from: f, to: t, promotion: p });
    if (res) {
        if (window.playMoveSound) playMoveSound(res);
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
    renderBoard(true); updateMoveLog(); updateStatus(); runAnalysisTask();
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
        row.innerHTML = `<span style="color:#666;width:25px;display:inline-block;">${num}.</span>
        <span class="move-text ${w.id===activeNode.id?'active-move':''}" style="cursor:pointer;padding:0 5px;" onclick="jumpToNodeByID(${w.id})">${w.move.san}</span>
        ${b ? `<span class="move-text ${b.id===activeNode.id?'active-move':''}" style="cursor:pointer;padding:0 5px;" onclick="jumpToNodeByID(${b.id})">${b.move.san}</span>` : ''}`;
        log.appendChild(row);
    }
    updateBranchSelector();
}

window.jumpToNodeByID = (id) => {
    const find = (root, targetId) => {
        if (root.id === targetId) return root;
        for (let c of root.children) { let res = find(c, targetId); if (res) return res; }
        return null;
    };
    jumpToMoveNode(find(moveHistoryTree, id));
};

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
    const container = document.querySelector('.promotion-choices'), turn = game.turn();
    container.innerHTML = '';
    ['q','r','b','n'].forEach(p => {
        const btn = document.createElement('button');
        btn.innerHTML = `<img src="${pieceImagePaths[turn+p.toUpperCase()]}" style="width:100%">`;
        btn.onclick = () => { executeAnalysisMove(promotionFrom, promotionTo, p); document.getElementById('promotion-modal').classList.add('hidden'); };
        container.appendChild(btn);
    });
}

function navigatePrev() { if (activeNode.parent) jumpToMoveNode(activeNode.parent); }
function navigateNext() { if (activeNode.children.length > 0) jumpToMoveNode(activeNode.children[0]); }
function navigateLast() { let t = activeNode; while(t.children.length > 0) t = t.children[0]; jumpToMoveNode(t); }
function startNewGame() { game = new Chess(); moveHistoryTree = { id:0, parent:null, move:null, children:[] }; activeNode = moveHistoryTree; finalizeMove(); }
function flipBoard() { isFlipped = !isFlipped; renderBoard(true); }
function clearSelection() { selectedSquare = null; validMoves = []; renderBoard(false); }
function updateStatus() { document.getElementById('status-text').textContent = game.in_checkmate() ? "Мат!" : "Анализ"; }
function updateEvaluationBar(cp) {
    const fill = document.getElementById('eval-fill');
    let p = 50 + (Math.max(-800, Math.min(800, cp)) / 800) * 45;
    if (fill) fill.style.height = `${p}%`;
    const text = document.getElementById('eval-text');
    if (text) text.textContent = (cp / 100).toFixed(1);
}
function renderMultiPV() {
    const container = document.getElementById('multipv-container');
    if (!container) return;
    container.innerHTML = analysisLines.map(line => `<div style="display:flex;gap:10px;font-family:monospace;font-size:0.85rem;background:rgba(255,255,255,0.05);padding:5px;margin-bottom:2px;"><div style="font-weight:bold;color:#fff;min-width:40px;">${line.score}</div><div style="color:#258039;font-weight:bold;">${line.move}</div><div style="color:#777;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${line.path}</div></div>`).join('');
}
