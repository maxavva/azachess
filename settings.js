// settings.js — общий модуль настроек для всего приложения

export function initSettings(onApplyCallback) {
    const openBtn = document.getElementById('btn-settings-open');
    const closeBtn = document.getElementById('btn-settings-close');
    const modal = document.getElementById('settings-modal');
    if (!openBtn || !closeBtn || !modal) return;

    const optSound = document.getElementById('opt-sound');
    const optHints = document.getElementById('opt-hints');
    const optCoords = document.getElementById('opt-coords');
    const optTheme = document.getElementById('opt-theme');

    // Загрузка сохраненных значений
    optSound.checked = localStorage.getItem('azachess-setting-sound') !== 'false';
    optHints.checked = localStorage.getItem('azachess-setting-hints') !== 'false';
    optCoords.checked = localStorage.getItem('azachess-setting-coords') !== 'false';
    optTheme.value = localStorage.getItem('azachess-setting-theme') || 'emerald';

    openBtn.onclick = () => modal.classList.remove('hidden');

    closeBtn.onclick = () => {
        localStorage.setItem('azachess-setting-sound', optSound.checked);
        localStorage.setItem('azachess-setting-hints', optHints.checked);
        localStorage.setItem('azachess-setting-coords', optCoords.checked);
        localStorage.setItem('azachess-setting-theme', optTheme.value);
        
        modal.classList.add('hidden');
        applySettings(onApplyCallback);
    };

    applySettings(onApplyCallback);
}

export function applySettings(onApplyCallback) {
    const boardEl = document.getElementById('board');
    if (!boardEl) return;

    const theme = localStorage.getItem('azachess-setting-theme') || 'emerald';
    const coords = localStorage.getItem('azachess-setting-coords') !== 'false';

    // Сброс и применение темы
    boardEl.className = 'chessboard';
    boardEl.classList.add(`theme-${theme}`);

    // Переключение координат
    if (coords) {
        boardEl.classList.remove('hide-coordinates');
    } else {
        boardEl.classList.add('hide-coordinates');
    }

    // Вызываем колбэк перерисовки конкретной доски
    if (typeof onApplyCallback === 'function') {
        onApplyCallback();
    }
}
