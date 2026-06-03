// Используем прямые и стабильные ссылки на звуки Lichess
const soundUrls = {
    move: 'https://raw.githubusercontent.com/clime-ch/chess-sounds/master/move.mp3',
    capture: 'https://raw.githubusercontent.com/clime-ch/chess-sounds/master/capture.mp3',
    check: 'https://raw.githubusercontent.com/clime-ch/chess-sounds/master/check.mp3',
    gameEnd: 'https://raw.githubusercontent.com/clime-ch/chess-sounds/master/notify.mp3',
    promote: 'https://raw.githubusercontent.com/clime-ch/chess-sounds/master/promote.mp3'
};

const chessSounds = {};

// Инициализация звукового движка
function initSounds() {
    console.log("Загрузка звуковых ресурсов...");
    for (let key in soundUrls) {
        const audio = new Audio(soundUrls[key]);
        audio.preload = 'auto';
        audio.crossOrigin = "anonymous"; // Чтобы избежать проблем с доступом
        chessSounds[key] = audio;

        // Проверка загрузки
        audio.addEventListener('error', (e) => {
            console.warn(`Не удалось загрузить звук: ${key}. Проверьте соединение.`);
        });
    }
}

initSounds();

// Разблокировка аудио для браузера (нужно нажать на любую часть сайта)
function unlockAudio() {
    console.log("Звуковая система Azachess активирована");
    for (let key in chessSounds) {
        const s = chessSounds[key];
        s.play().then(() => { 
            s.pause(); 
            s.currentTime = 0; 
        }).catch(e => {});
    }
    window.removeEventListener('click', unlockAudio);
    window.removeEventListener('touchstart', unlockAudio);
}

window.addEventListener('click', unlockAudio);
window.addEventListener('touchstart', unlockAudio);

// Основная функция воспроизведения
function playMoveSound(result) {
    if (!result) return;
    
    try {
        let soundToPlay = chessSounds.move;

        // Определяем тип звука (обязательно проверяем существование game)
        const isCheck = (typeof game !== 'undefined' && game && typeof game.in_check === 'function') ? game.in_check() : false;
        const isGameOver = (typeof game !== 'undefined' && game && typeof game.game_over === 'function') ? game.game_over() : false;

        if (isCheck) {
            soundToPlay = chessSounds.check;
        } else if (result.flags && (result.flags.includes('c') || result.flags.includes('e'))) {
            soundToPlay = chessSounds.capture;
        } else if (result.flags && result.flags.includes('p')) {
            soundToPlay = chessSounds.promote;
        }

        // Воспроизведение
        if (soundToPlay) {
            soundToPlay.currentTime = 0;
            soundToPlay.play().catch(error => {
                console.log("Браузер заблокировал звук. Требуется клик по странице.");
            });
        }

        // Звук финала
        if (isGameOver) {
            setTimeout(() => {
                if (chessSounds.gameEnd) {
                    chessSounds.gameEnd.currentTime = 0;
                    chessSounds.gameEnd.play().catch(() => {});
                }
            }, 600);
        }
    } catch (e) {
        console.error("Ошибка звука:", e);
    }
}
