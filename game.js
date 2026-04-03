/*
  game.js is now a small entry module that bootstraps the refactored engine.
  The original large file was split into:
    - assets.js   (asset constants, loader, audio helper)
    - engine.js   (game state, update/draw loop, controls)
  Tombstones below indicate removed code that now lives in modules.
*/

// removed function loadAssets() {}
// removed lots of game logic, update(), draw(), startGame(), endGame(), etc.
// removed input handling and joystick setup
// removed UI helpers like updateLivesUI() and updateShieldUI()

import('./assets.js').then(modAssets => {
    return import('./engine.js').then(modEngine => {
        // initialize engine with DOM references and the assets module
        modEngine.init({
            assets: modAssets,
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
            // new UI elements
            timerId: 'timer',
            streakId: 'streak',
            sendLetterBtnId: 'send-letter-btn',
            // gender UI IDs (start screen controls / HUD displays)
            playerGender1MId: 'p1-gender-m',
            playerGender1FId: 'p1-gender-f',
            playerGender2MId: 'p2-gender-m',
            playerGender2FId: 'p2-gender-f'
        });
    });
});