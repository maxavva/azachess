// Самый надежный CDN (Lichess Assets)
const soundUrls = {
    move: 'https://lichess1.org/assets/sound/standard/Move.mp3',
    capture: 'https://lichess1.org/assets/sound/standard/Capture.mp3',
    check: 'https://lichess1.org/assets/sound/standard/Check.mp3',
    gameEnd: 'https://lichess1.org/assets/sound/standard/GenericNotify.mp3',
    promote: 'https://lichess1.org/assets/sound/standard/Promote.mp3'
};

const chessSounds = {};
let isAudioReady = false;

// Инициализация
function initSounds() {
    for (let key in soundUrls) {
        const audio = new Audio(soundUrls[key]);
        audio.preload = 'auto';
        audio.crossOrigin = "anonymous";
        chessSounds[key] = audio;
    }
}
initSounds();

// ФУНКЦИЯ РАЗБЛОКИРОВКИ (должна сработать от клика)
function unlockAudio() {
    if (isAudioReady) return;
    
    console.log("Активация звукового движка...");
    
    for (let key in chessSounds) {
        const sound = chessSounds[key];
        // Важнейший момент: "играем" тишину
        const promise = sound.play();
        if (promise !== undefined) {
            promise.then(() => {
                sound.pause();
                sound.currentTime = 0;
            }).catch(err => {
                console.warn("Браузер всё еще блокирует звук: " + key);
            });
        }
    }
    
    isAudioReady = true;
    // Убираем слушателей
    window.removeEventListener('mousedown', unlockAudio);
    window.removeEventListener('touchstart', unlockAudio);
    window.removeEventListener('keydown', unlockAudio);
}

// Ждем любого действия от пользователя
window.addEventListener('mousedown', unlockAudio);
window.addEventListener('touchstart', unlockAudio);
window.addEventListener('keydown', unlockAudio);

function playMoveSound(result) {
    if (!result) return;
    
    // Если ИИ делает ход, а пользователь еще не кликнул - звук не сработает (защита браузера)
    if (!isAudioReady) return;

    try {
        let sound = chessSounds.move;

        // Проверка через объект game (который должен быть в app.js)
        const chessGame = window.game; 
        const isCheck = (chessGame && typeof chessGame.in_check === 'function') ? chessGame.in_check() : false;
        const isOver = (chessGame && typeof chessGame.game_over === 'function') ? chessGame.game_over() : false;

        if (isCheck) {
            sound = chessSounds.check;
        } else if (result.flags && (result.flags.includes('c') || result.flags.includes('e'))) {
            sound = chessSounds.capture;
        } else if (result.flags && result.flags.includes('p')) {
            sound = chessSounds.promote;
        }

        if (sound) {
            sound.currentTime = 0;
            sound.play().catch(() => {});
        }

        if (isOver) {
            setTimeout(() => {
                if (chessSounds.gameEnd) {
                    chessSounds.gameEnd.currentTime = 0;
                    chessSounds.gameEnd.play().catch(() => {});
                }
            }, 450);
        }
    } catch (e) {
        console.error("Audio Error:", e);
    }
}
