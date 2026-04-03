// game.js - Entry point
import('./assets.js').then(modAssets => {
    return import('./engine.js').then(modEngine => {
        modEngine.init({
            canvasId: 'gameCanvas',
            startScreenId: 'start-screen',
            gameOverId: 'game-over-screen',
            startBtnId: 'start-btn',
            restartBtnId: 'restart-btn',
            scoreId: 'score',
            finalScoreId: 'final-score',
            livesContainerId: 'lives-container',
            shootBtnId: 'shoot-btn',
            volumeBtnId: 'volume-btn',
            shieldBtnId: 'shield-btn',
            shieldFillId: 'shield-fill',
            joystickZoneId: 'joystick-zone',
            timerId: 'timer',
            streakId: 'streak',
            sendLetterBtnId: 'send-letter-btn'
        });
    });
}).catch(err => {
    console.error("Error al cargar el juego:", err);
    alert("Error al cargar el juego. Revisa la consola (F12)");
});
