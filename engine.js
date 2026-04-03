/* engine.js */
import nipplejs from 'nipplejs';

let canvas, ctx;
let elements = {};
let assetsModule = null;

let gameRunning = false;
let score = 0;
let lives = 5;
let lastTime = 0;
let nextEnemyTime = 0;
let nextCloudTime = 0;

let shieldActive = false;
let shieldTime = 0;
const SHIELD_DURATION = 3.0;
let shieldCooldown = 0;
const SHIELD_COOLDOWN = 5.0;

let swordActive = false;
let swordTime = 0;
const SWORD_DURATION = 0.35;
const SWORD_RANGE = 160;
const SWORD_DAMAGE = 5;

const player = { x: 100, y: 0, width: 110, height: 110, speed: 9, dx: 0, dy: 0, bullets: [], lastShot: 0, shootDelay: 250, angle: 0 };
const secondPlayer = { x: 100, y: 80, width: 90, height: 70, speed: 7, dx: 0, dy: 0, angle: 0 };

let enemies = [];
let clouds = [];
let particles = [];
let counterMissiles = [];
let playerMissiles = [];
let letters = [];
let engineSoundSource = null;
let mpChannel = null;
let playerId = 'p_' + Math.random().toString(36).slice(2,9);
let sessionSeconds = 0;

const keys = {};

function $(id) { return document.getElementById(id); }

function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}

function setupJoystick(joystickZoneId) {
    const options = {
        zone: $(joystickZoneId),
        mode: 'static',
        position: { left: '60px', bottom: '60px' },
        color: 'white'
    };
    const joystick = nipplejs.create(options);
    joystick.on('move', (evt, data) => {
        if (data.vector) {
            player.dx = data.vector.x * player.speed;
            player.dy = -data.vector.y * player.speed;
            player.angle = Math.atan2(-data.vector.y, data.vector.x) * 0.1;
        }
    });
    joystick.on('end', () => {
        player.dx = 0;
        player.dy = 0;
        player.angle = 0;
    });
}

function setupKeyboard(shootCallback, shieldCallback, swordCallback, letterCallback) {
    window.addEventListener('keydown', (e) => {
        keys[e.code] = true;
        if (e.code === 'Space') shootCallback();
        if (e.code === 'KeyE') shieldCallback();
        if (e.code === 'KeyF') swordCallback();
        if (e.code === 'KeyC' && letterCallback) letterCallback();
    });
    window.addEventListener('keyup', (e) => keys[e.code] = false);
}

function handleKeyboard() {
    // Player 1 (WASD)
    player.dx = player.dy = 0;
    if (keys['KeyW']) player.dy = -player.speed;
    if (keys['KeyS']) player.dy = player.speed;
    if (keys['KeyA']) player.dx = -player.speed;
    if (keys['KeyD']) player.dx = player.speed;
    if (player.dy !== 0) player.angle = player.dy > 0 ? 0.1 : -0.1;

    // Player 2 (Arrow keys)
    secondPlayer.dx = secondPlayer.dy = 0;
    if (keys['ArrowUp']) secondPlayer.dy = -secondPlayer.speed;
    if (keys['ArrowDown']) secondPlayer.dy = secondPlayer.speed;
    if (keys['ArrowLeft']) secondPlayer.dx = -secondPlayer.speed;
    if (keys['ArrowRight']) secondPlayer.dx = secondPlayer.speed;
    if (secondPlayer.dy !== 0) secondPlayer.angle = secondPlayer.dy > 0 ? 0.08 : -0.08;
}

// ... (Mantengo las funciones updateLivesUI, updateShieldUI, updateScoreUI, etc. igual que antes)

function updateLivesUI() {
    const container = $(elements.livesContainerId);
    if (!container) return;
    container.innerHTML = '';
    for (let i = 0; i < lives; i++) {
        const heart = document.createElement('span');
        heart.className = 'heart';
        heart.innerHTML = '❤';
        container.appendChild(heart);
    }
}

function updateShieldUI() {
    const fill = $(elements.shieldFillId);
    if (!fill) return;
    if (shieldActive) {
        const pct = Math.max(0, Math.min(1, shieldTime / SHIELD_DURATION));
        fill.style.width = `${Math.floor(pct * 100)}%`;
        fill.style.background = 'linear-gradient(90deg,#4ee,#08f)';
    } else {
        const pct = shieldCooldown > 0 ? Math.max(0, Math.min(1, 1 - shieldCooldown / SHIELD_COOLDOWN)) : 1;
        fill.style.width = `${Math.floor(pct * 100)}%`;
        fill.style.background = shieldCooldown > 0 ? 'linear-gradient(90deg,#888,#444)' : 'linear-gradient(90deg,#4efc9a,#08f)';
    }
}

// (Las demás funciones: updateScoreUI, updateTimerUI, shoot, activateShield, sendLetter, swingSword, etc. se mantienen igual)

function createExplosion(x, y) {
    for (let i = 0; i < 15; i++) {
        particles.push({
            x, y,
            vx: (Math.random() - 0.5) * 10,
            vy: (Math.random() - 0.5) * 10,
            life: 1,
            color: Math.random() > 0.5 ? '#ff9800' : '#333'
        });
    }
}

// update() y draw() se mantienen igual que en tu versión original (son muy largas)

function update(dt) {
    if (!gameRunning) return;
    // ... (todo tu código de update aquí - copia el que tenías)
    // Solo asegúrate de usar assetsModule.XXXX
}

function draw() {
    // ... (todo tu código de draw aquí)
}

function loop(timestamp) {
    const dt = timestamp - lastTime;
    lastTime = timestamp;
    update(dt);
    draw();
    requestAnimationFrame(loop);
}

function startGame() {
    if (assetsModule.audioCtx.state === 'suspended') assetsModule.audioCtx.resume();
    // reset variables...
    score = 0; lives = 5; enemies = []; player.bullets = []; clouds = []; counterMissiles = []; letters = []; playerMissiles = []; sessionSeconds = 0;
    
    updateScoreUI();
    updateLivesUI();
    updateTimerUI();
    $(elements.startScreenId).classList.add('hidden');
    $(elements.gameOverId).classList.add('hidden');
    gameRunning = true;
    
    if (!assetsModule.isMuted()) assetsModule.playSound(assetsModule.sounds.meow);
    if (engineSoundSource) try { engineSoundSource.stop(); } catch(e){}
    engineSoundSource = assetsModule.playSound(assetsModule.sounds.engine, true);
}

function endGame() {
    gameRunning = false;
    $(elements.gameOverId).classList.remove('hidden');
    $(elements.finalScoreId).innerText = `Puntaje Final: ${score}`;
    if (engineSoundSource) try { engineSoundSource.stop(); } catch(e){}
    engineSoundSource = null;
}

export function init(opts) {
    elements = opts;
    canvas = document.getElementById(opts.canvasId);
    ctx = canvas.getContext('2d');

    window.addEventListener('resize', resize);
    resize();

    setupJoystick(opts.joystickZoneId);
    setupKeyboard(() => shoot(), activateShield, swingSword, sendLetter);

    // Botones móviles y UI (mantengo tu lógica anterior)
    // ... (copia aquí el resto de wiring de botones que tenías)

    requestAnimationFrame(loop);
}
