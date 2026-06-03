// Надежные звуки с Wikimedia
const soundUrls = {
    move: 'https://upload.wikimedia.org/wikipedia/commons/b/b1/Chess_move.ogg',
    capture: 'https://upload.wikimedia.org/wikipedia/commons/a/af/Chess_capture.ogg',
    check: 'https://upload.wikimedia.org/wikipedia/commons/d/d5/Chess_check.ogg',
    gameEnd: 'https://upload.wikimedia.org/wikipedia/commons/e/e0/Generic_Notify.ogg',
    promote: 'https://upload.wikimedia.org/wikipedia/commons/3/30/Chess_promote.ogg'
};

const chessSounds = {};

function initSounds() {
    for (let key in soundUrls) {
        chessSounds[key] = new Audio(soundUrls[key]);
        chessSounds[key].load();
    }
}
initSounds();

function unlockAudio() {
    for (let key in chessSounds) {
        let s = chessSounds[key];
        s.play().then(() => { s.pause(); s.currentTime = 0; }).catch(() => {});
    }
    window.removeEventListener('click', unlockAudio);
}
window.addEventListener('click', unlockAudio);

function playMoveSound(result) {
    if (!result) return;
    try {
        let sound = chessSounds.move;
        if (game && game.in_check()) sound = chessSounds.check;
        else if (result.flags.includes('c') || result.flags.includes('e')) sound = chessSounds.capture;
        else if (result.flags.includes('p')) sound = chessSounds.promote;

        sound.currentTime = 0;
        sound.play().catch(() => {});

        if (game && game.game_over()) {
            setTimeout(() => {
                chessSounds.gameEnd.currentTime = 0;
                chessSounds.gameEnd.play().catch(() => {});
            }, 600);
        }
    } catch (e) {}
}
