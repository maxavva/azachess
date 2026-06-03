// Используем надежные ссылки из репозитория Lichess
const soundUrls = {
    move: 'https://raw.githubusercontent.com/lichess-org/lila/master/public/sound/standard/Move.mp3',
    capture: 'https://raw.githubusercontent.com/lichess-org/lila/master/public/sound/standard/Capture.mp3',
    check: 'https://raw.githubusercontent.com/lichess-org/lila/master/public/sound/standard/Check.mp3',
    gameEnd: 'https://raw.githubusercontent.com/lichess-org/lila/master/public/sound/standard/GenericNotify.mp3',
    promote: 'https://raw.githubusercontent.com/lichess-org/lila/master/public/sound/standard/Promote.mp3'
};

const chessSounds = {};

// Предзагрузка звуков
function initSounds() {
    for (let key in soundUrls) {
        chessSounds[key] = new Audio(soundUrls[key]);
        chessSounds[key].load(); // Принудительная загрузка в кэш
    }
}

initSounds();

// Функция разблокировки звука (обязательна для браузеров)
function unlockAudio() {
    console.log("Попытка разблокировки аудио...");
    for (let key in chessSounds) {
        let sound = chessSounds[key];
        sound.play().then(() => {
            sound.pause();
            sound.currentTime = 0;
        }).catch(e => console.log("Браузер пока блокирует звук для: " + key));
    }
    window.removeEventListener('click', unlockAudio);
}

window.addEventListener('click', unlockAudio);

// Основная функция проигрывания
function playMoveSound(result) {
    if (!result) return;
    
    try {
        let soundToPlay = null;

        // Если шах
        if (typeof game !== 'undefined' && game.in_check()) {
            soundToPlay = chessSounds.check;
        } 
        // Если взятие
        else if (result.flags.includes('c') || result.flags.includes('e')) {
            soundToPlay = chessSounds.capture;
        } 
        // Обычный ход
        else {
            soundToPlay = chessSounds.move;
        }

        if (soundToPlay) {
            soundToPlay.currentTime = 0;
            soundToPlay.play().catch(e => console.warn("Звук не смог проиграться:", e));
        }

        // Звук конца игры
        if (typeof game !== 'undefined' && game.game_over()) {
            setTimeout(() => {
                chessSounds.gameEnd.currentTime = 0;
                chessSounds.gameEnd.play();
            }, 500);
        }
    } catch (e) {
        console.error("Ошибка в playMoveSound:", e);
    }
}