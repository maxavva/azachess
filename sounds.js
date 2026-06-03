// Используем максимально надежные ссылки через jsDelivr (копия звуков Lichess)
const soundUrls = {
    move: 'https://cdn.jsdelivr.net/gh/lichess-org/lila@master/public/sound/standard/Move.mp3',
    capture: 'https://cdn.jsdelivr.net/gh/lichess-org/lila@master/public/sound/standard/Capture.mp3',
    check: 'https://cdn.jsdelivr.net/gh/lichess-org/lila@master/public/sound/standard/Check.mp3',
    gameEnd: 'https://cdn.jsdelivr.net/gh/lichess-org/lila@master/public/sound/standard/GenericNotify.mp3',
    promote: 'https://cdn.jsdelivr.net/gh/lichess-org/lila@master/public/sound/standard/Promote.mp3'
};

const chessSounds = {};

// Инициализация звукового движка
function initSounds() {
    for (let key in soundUrls) {
        const audio = new Audio(soundUrls[key]);
        audio.preload = 'auto';
        chessSounds[key] = audio;
    }
}

initSounds();

// Разблокировка аудио для браузера (нужно нажать на любую часть сайта)
function unlockAudio() {
    console.log("Звуковая система Azachess активирована");
    for (let key in chessSounds) {
        const s = chessSounds[key];
        // Пытаемся воспроизвести тишину, чтобы браузер разрешил звук
        s.play().then(() => { 
            s.pause(); 
            s.currentTime = 0; 
        }).catch(e => console.log("Браузер ждет клика для звука: " + key));
    }
    window.removeEventListener('click', unlockAudio);
    window.removeEventListener('touchstart', unlockAudio);
}

window.addEventListener('click', unlockAudio);
window.addEventListener('touchstart', unlockAudio);

// Основная функция воспроизведения
function playMoveSound(result) {
    if (!result || !chessSounds.move) return;
    
    try {
        let soundToPlay = chessSounds.move;

        // Определяем тип звука
        if (typeof game !== 'undefined' && game.in_check()) {
            soundToPlay = chessSounds.check;
        } else if (result.flags.includes('c') || result.flags.includes('e')) {
            soundToPlay = chessSounds.capture;
        } else if (result.flags.includes('p')) {
            soundToPlay = chessSounds.promote;
        }

        // Воспроизведение
        if (soundToPlay) {
            soundToPlay.currentTime = 0;
            const playPromise = soundToPlay.play();
            
            if (playPromise !== undefined) {
                playPromise.catch(error => {
                    console.warn("Браузер заблокировал звук. Кликните по доске.");
                });
            }
        }

        // Звук финала
        if (typeof game !== 'undefined' && game.game_over()) {
            setTimeout(() => {
                chessSounds.gameEnd.currentTime = 0;
                chessSounds.gameEnd.play().catch(() => {});
            }, 600);
        }
    } catch (e) {
        console.error("Ошибка звука:", e);
    }
}
