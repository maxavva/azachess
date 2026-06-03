const soundUrls = {
    move: 'https://www.chess.com/chess-themes/sounds/_standard/default/move-self.mp3',
    capture: 'https://www.chess.com/chess-themes/sounds/_standard/default/capture.mp3',
    check: 'https://www.chess.com/chess-themes/sounds/_standard/default/move-check.mp3',
    gameEnd: 'https://www.chess.com/chess-themes/sounds/_standard/default/game-end.mp3',
    promote: 'https://www.chess.com/chess-themes/sounds/_standard/default/promote.mp3'
};

const chessSounds = {};

// Предзагрузка с обработкой ошибок
function initSounds() {
    for (let key in soundUrls) {
        const audio = new Audio(soundUrls[key]);
        audio.preload = 'auto';
        chessSounds[key] = audio;
    }
}

initSounds();

function unlockAudio() {
    for (let key in chessSounds) {
        const s = chessSounds[key];
        s.play().then(() => { s.pause(); s.currentTime = 0; }).catch(() => {});
    }
    window.removeEventListener('click', unlockAudio);
}

window.addEventListener('click', unlockAudio);

function playMoveSound(result) {
    if (!result) return;
    try {
        let sound = chessSounds.move;
        
        if (typeof game !== 'undefined' && game.in_check()) {
            sound = chessSounds.check;
        } else if (result.flags.includes('c') || result.flags.includes('e')) {
            sound = chessSounds.capture;
        } else if (result.flags.includes('p')) {
            sound = chessSounds.promote;
        }

        if (sound) {
            sound.currentTime = 0;
            sound.play().catch(e => console.warn("Звук временно недоступен"));
        }

        if (typeof game !== 'undefined' && game.game_over()) {
            setTimeout(() => chessSounds.gameEnd.play().catch(() => {}), 500);
        }
    } catch (e) {
        // Если звук сломался, просто игнорируем его, чтобы игра работала дальше
    }
}
