// Самые стабильные ссылки (Lichess CDN)
const soundUrls = {
    move: 'https://cdn.jsdelivr.net/gh/lichess-org/lila@master/public/sound/standard/Move.mp3',
    capture: 'https://cdn.jsdelivr.net/gh/lichess-org/lila@master/public/sound/standard/Capture.mp3',
    check: 'https://cdn.jsdelivr.net/gh/lichess-org/lila@master/public/sound/standard/Check.mp3',
    gameEnd: 'https://cdn.jsdelivr.net/gh/lichess-org/lila@master/public/sound/standard/GenericNotify.mp3',
    promote: 'https://cdn.jsdelivr.net/gh/lichess-org/lila@master/public/sound/standard/Promote.mp3'
};

const chessSounds = {};
let isAudioUnlocked = false;

// Предварительная загрузка
function initSounds() {
    for (let key in soundUrls) {
        const audio = new Audio(soundUrls[key]);
        audio.preload = 'auto';
        audio.volume = 1.0;
        chessSounds[key] = audio;
    }
}
initSounds();

// Функция полной разблокировки всех звуков
// Должна быть вызвана ОДИН РАЗ внутри обработчика события клика
function unlockAllSounds() {
    if (isAudioUnlocked) return;
    
    console.log("Разблокировка всех звуковых каналов...");
    
    for (let key in chessSounds) {
        const sound = chessSounds[key];
        // Воспроизводим и сразу ставим на паузу — это "легализует" звук для браузера
        const playPromise = sound.play();
        if (playPromise !== undefined) {
            playPromise.then(() => {
                sound.pause();
                sound.currentTime = 0;
            }).catch(e => {
                console.warn("Не удалось 'прогреть' звук: " + key);
            });
        }
    }
    
    isAudioUnlocked = true;
    // Удаляем слушателей после успеха
    window.removeEventListener('mousedown', unlockAllSounds);
    window.removeEventListener('touchstart', unlockAllSounds);
}

// Вешаем разблокировку на любое действие пользователя
window.addEventListener('mousedown', unlockAllSounds);
window.addEventListener('touchstart', unlockAllSounds);

function playMoveSound(result) {
    if (!result) return;
    
    // Если еще не разблокировано, пытаемся разблокировать сейчас
    if (!isAudioUnlocked) unlockAllSounds();

    try {
        let soundToPlay = chessSounds.move;
        
        // Проверка состояния через chess.js флаги и методы
        const isCheck = (typeof game !== 'undefined' && game && game.in_check()) ? true : false;
        const isGameOver = (typeof game !== 'undefined' && game && game.game_over()) ? true : false;

        if (isCheck) {
            soundToPlay = chessSounds.check;
        } else if (result.flags && (result.flags.includes('c') || result.flags.includes('e'))) {
            soundToPlay = chessSounds.capture;
        } else if (result.flags && result.flags.includes('p')) {
            soundToPlay = chessSounds.promote;
        }

        if (soundToPlay) {
            soundToPlay.currentTime = 0;
            const playPromise = soundToPlay.play();
            if (playPromise !== undefined) {
                playPromise.catch(e => {
                    // Это сообщение мы игнорируем, оно будет только до первого клика
                });
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
        console.error("Ошибка звукового движка:", e);
    }
}
