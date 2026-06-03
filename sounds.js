// Используем максимально открытые ссылки (Wikimedia Commons)
const soundUrls = {
    move: 'https://upload.wikimedia.org/wikipedia/commons/b/b1/Chess_move.piece.ogg',
    capture: 'https://upload.wikimedia.org/wikipedia/commons/d/d1/Chess_move.capture.ogg',
    check: 'https://upload.wikimedia.org/wikipedia/commons/1/1a/Chess_move.check.ogg',
    gameEnd: 'https://upload.wikimedia.org/wikipedia/commons/f/f7/Chess_move.end.ogg',
    promote: 'https://upload.wikimedia.org/wikipedia/commons/e/e0/Chess_move.promote.ogg'
};

const chessSounds = {};
let audioUnlocked = false;

// Предзагрузка
function initSounds() {
    for (let key in soundUrls) {
        chessSounds[key] = new Audio(soundUrls[key]);
        chessSounds[key].preload = 'auto';
    }
}

initSounds();

// Функция "прогрева" звуков - вызывается при первом реальном клике на доску
function forceUnlockAudio() {
    if (audioUnlocked) return;
    
    console.log("Разблокировка аудио Azachess...");
    for (let key in chessSounds) {
        const s = chessSounds[key];
        s.play().then(() => {
            s.pause();
            s.currentTime = 0;
        }).catch(() => {});
    }
    audioUnlocked = true;
}

// Слушаем любые клики по странице для разблокировки
window.addEventListener('mousedown', forceUnlockAudio, { once: false });
window.addEventListener('touchstart', forceUnlockAudio, { once: false });

function playMoveSound(result) {
    if (!result) return;
    
    // Если еще не разблокировали - пробуем разблокировать сейчас
    if (!audioUnlocked) forceUnlockAudio();

    try {
        let sound = chessSounds.move;
        
        // Проверка состояния игры
        const isCheck = (typeof game !== 'undefined' && game && game.in_check()) ? true : false;
        const isGameOver = (typeof game !== 'undefined' && game && game.game_over()) ? true : false;

        if (isCheck) {
            sound = chessSounds.check;
        } else if (result.flags && (result.flags.includes('c') || result.flags.includes('e'))) {
            sound = chessSounds.capture;
        } else if (result.flags && result.flags.includes('p')) {
            sound = chessSounds.promote;
        }

        if (sound) {
            sound.currentTime = 0;
            const playPromise = sound.play();
            if (playPromise !== undefined) {
                playPromise.catch(e => console.warn("Аудио всё еще заблокировано браузером. Нужно кликнуть по странице."));
            }
        }

        if (isGameOver) {
            setTimeout(() => {
                if (chessSounds.gameEnd) {
                    chessSounds.gameEnd.currentTime = 0;
                    chessSounds.gameEnd.play().catch(() => {});
                }
            }, 500);
        }
    } catch (e) {
        console.error("Ошибка звука:", e);
    }
}
