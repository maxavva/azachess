// Используем обновленные прямые ссылки на звуки
const soundUrls = {
    move: 'https://raw.githubusercontent.com/ornicar/lila/master/public/sound/standard/Move.mp3',
    capture: 'https://raw.githubusercontent.com/ornicar/lila/master/public/sound/standard/Capture.mp3',
    check: 'https://raw.githubusercontent.com/ornicar/lila/master/public/sound/standard/Check.mp3',
    gameEnd: 'https://raw.githubusercontent.com/ornicar/lila/master/public/sound/standard/GenericNotify.mp3',
    promote: 'https://raw.githubusercontent.com/ornicar/lila/master/public/sound/standard/Promote.mp3'
};

const chessSounds = {};
let isAudioReady = false;

function initSounds() {
    for (let key in soundUrls) {
        const audio = new Audio(soundUrls[key]);
        audio.preload = 'auto';
        // Убираем crossOrigin, так как на GitHub/Raw он иногда мешает
        chessSounds[key] = audio;
    }
}
initSounds();

function unlockAudio() {
    if (isAudioReady) return;
    for (let key in chessSounds) {
        const sound = chessSounds[key];
        const promise = sound.play();
        if (promise !== undefined) {
            promise.then(() => {
                sound.pause();
                sound.currentTime = 0;
            }).catch(err => console.warn("Звук заблокирован браузером"));
        }
    }
    isAudioReady = true;
}

window.addEventListener('mousedown', unlockAudio);
window.addEventListener('touchstart', unlockAudio);

function playMoveSound(result) {
    // Проверка пользовательской настройки звука перед проигрыванием
    if (localStorage.getItem('azachess-setting-sound') === 'false') return;
    
    if (!result || !isAudioReady) return;
    try {
        let sound = chessSounds.move;
        const chessGame = window.game; 
        
        const isCheck = (chessGame && typeof chessGame.in_check === 'function') ? chessGame.in_check() : false;
        const isOver = (chessGame && typeof chessGame.game_over === 'function') ? chessGame.game_over() : false;

        if (isCheck) sound = chessSounds.check;
        else if (result.flags && (result.flags.includes('c') || result.flags.includes('e'))) sound = chessSounds.capture;
        else if (result.flags && result.flags.includes('p')) sound = chessSounds.promote;

        if (sound) {
            sound.currentTime = 0;
            sound.play().catch(e => console.error("Ошибка воспроизведения:", e));
        }

        if (isOver && chessSounds.gameEnd) {
            setTimeout(() => {
                chessSounds.gameEnd.currentTime = 0;
                chessSounds.gameEnd.play().catch(() => {});
            }, 450);
        }
    } catch (e) {
        console.error("Ошибка звукового движка:", e);
    }
}

        if (isOver && chessSounds.gameEnd) {
            setTimeout(() => {
                chessSounds.gameEnd.currentTime = 0;
                chessSounds.gameEnd.play().catch(() => {});
            }, 450);
        }
    } catch (e) {
        console.error("Ошибка звукового движка:", e);
    }
}
