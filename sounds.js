// Используем максимально надежные ссылки
const soundUrls = {
    move: 'https://raw.githubusercontent.com/maxavva/azachess/main/move.mp3', // Резерв на случай, если основные упадут
    capture: 'https://raw.githubusercontent.com/clime-ch/chess-sounds/master/capture.mp3',
    check: 'https://raw.githubusercontent.com/clime-ch/chess-sounds/master/check.mp3',
    gameEnd: 'https://raw.githubusercontent.com/clime-ch/chess-sounds/master/notify.mp3',
    promote: 'https://raw.githubusercontent.com/clime-ch/chess-sounds/master/promote.mp3'
};

// Если те ссылки не сработают, используем эти (Lichess)
const backupUrls = {
    move: 'https://cdn.jsdelivr.net/gh/lichess-org/lila@master/public/sound/standard/Move.mp3',
    capture: 'https://cdn.jsdelivr.net/gh/lichess-org/lila@master/public/sound/standard/Capture.mp3',
    check: 'https://cdn.jsdelivr.net/gh/lichess-org/lila@master/public/sound/standard/Check.mp3',
    gameEnd: 'https://cdn.jsdelivr.net/gh/lichess-org/lila@master/public/sound/standard/GenericNotify.mp3',
    promote: 'https://cdn.jsdelivr.net/gh/lichess-org/lila@master/public/sound/standard/Promote.mp3'
};

const chessSounds = {};
let isAudioUnlocked = false;

// Предварительная настройка
function initSounds() {
    for (let key in backupUrls) {
        const audio = new Audio(backupUrls[key]);
        audio.preload = 'auto';
        audio.crossOrigin = "anonymous";
        chessSounds[key] = audio;
    }
}
initSounds();

// ФУНКЦИЯ "ПРОГРЕВА" - Самая важная часть
function unlockAllSounds() {
    if (isAudioUnlocked) return;
    
    console.log("Инициализация аудио-контекста...");
    
    for (let key in chessSounds) {
        const sound = chessSounds[key];
        // Устанавливаем минимальную громкость и проигрываем
        sound.volume = 0.1;
        const playPromise = sound.play();
        
        if (playPromise !== undefined) {
            playPromise.then(() => {
                // Мгновенно ставим на паузу и возвращаем в начало
                sound.pause();
                sound.currentTime = 0;
                sound.volume = 1.0; // Возвращаем полную громкость для игры
            }).catch(e => {
                console.log("Блокировка всё еще активна для: " + key);
            });
        }
    }
    
    isAudioUnlocked = true;
}

// Привязываем прогрев к ЛЮБОМУ клику по документу
document.addEventListener('click', unlockAllSounds, { once: true });
document.addEventListener('touchstart', unlockAllSounds, { once: true });

function playMoveSound(result) {
    if (!result || !isAudioUnlocked) return;

    try {
        let soundToPlay = chessSounds.move;

        // Проверка через глобальный объект game (из app.js)
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
            soundToPlay.play().catch(() => {
                // Если всё равно не вышло, просто молчим
            });
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
