/* New module: engine.js
   Contains main game loop, rendering and most game logic.
   It depends on assets.js for images/audio and expects the DOM element ids to be provided at init().
*/

import nipplejs from 'nipplejs';

let canvas, ctx;
let elements = {};
let assetsModule = null;

// Game variables (kept here so module is self-contained)
let gameRunning = false;
let score = 0;
let lives = 5;
let lastTime = 0;
let nextEnemyTime = 0;
let nextCloudTime = 0;

 // Shield state
 let shieldActive = false;
 let shieldTime = 0;
 const SHIELD_DURATION = 3.0;
 let shieldCooldown = 0;
 const SHIELD_COOLDOWN = 5.0;

 // Sword (melee) state
 let swordActive = false;
 let swordTime = 0;
 const SWORD_DURATION = 0.35; // seconds
 const SWORD_RANGE = 160; // px radius in front of player
 const SWORD_DAMAGE = 5;

const player = {
    x: 100,
    y: 0,
    width: 110,
    height: 110,
    speed: 9,
    dx: 0,
    dy: 0,
    bullets: [],
    lastShot: 0,
    shootDelay: 250,
    angle: 0
};

// Local second player (shares same keyboard) — controlled by arrow keys
const secondPlayer = {
    x: 100,
    y: 80,
    width: 90,
    height: 70,
    speed: 7,
    dx: 0,
    dy: 0,
    angle: 0
};

let enemies = [];
let clouds = [];
let particles = [];
let counterMissiles = [];
let playerMissiles = []; // missiles fired by the player that home on pug enemies
let letters = []; // letters (cartas) sent by player
let engineSoundSource = null;

// simple multiplayer channel for virtual real-time messaging between clients
// uses BroadcastChannel when available; messages: { type: 'letter', from: 'player-id', payload: { ... } }
let mpChannel = null;
let playerId = 'p_' + Math.random().toString(36).slice(2,9);

// session timer (seconds) shown in UI and tracked while playing
let sessionSeconds = 0;

function $(id) { return document.getElementById(id); }

function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    if (!gameRunning) {
        player.y = canvas.height / 2 - player.height / 2;
        secondPlayer.y = canvas.height / 2 - secondPlayer.height / 2 - 120;
    }
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

// input
const keys = {};
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
    player.dx = 0;
    player.dy = 0;
    if (keys['KeyW']) player.dy = -player.speed;
    if (keys['KeyS']) player.dy = player.speed;
    if (keys['KeyA']) player.dx = -player.speed;
    if (keys['KeyD']) player.dx = player.speed;

    if (player.dy !== 0) {
        player.angle = (player.dy > 0 ? 0.1 : -0.1);
    } else {
        player.angle = 0;
    }

    // Player 2 (Arrow keys) — local second player sharing keyboard
    secondPlayer.dx = 0;
    secondPlayer.dy = 0;
    if (keys['ArrowUp']) secondPlayer.dy = -secondPlayer.speed;
    if (keys['ArrowDown']) secondPlayer.dy = secondPlayer.speed;
    if (keys['ArrowLeft']) secondPlayer.dx = -secondPlayer.speed;
    if (keys['ArrowRight']) secondPlayer.dx = secondPlayer.speed;

    if (secondPlayer.dy !== 0) {
        secondPlayer.angle = (secondPlayer.dy > 0 ? 0.08 : -0.08);
    } else {
        secondPlayer.angle = 0;
    }
}

// helpers that manipulate UI
function updateLivesUI() {
    const container = $(elements.livesContainerId);
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
    const shieldBtn = $(elements.shieldBtnId);
    if (!fill) return;
    if (shieldActive) {
        const pct = Math.max(0, Math.min(1, shieldTime / SHIELD_DURATION));
        fill.style.width = `${Math.floor(pct * 100)}%`;
        fill.style.background = 'linear-gradient(90deg,#4ee,#08f)';
        shieldBtn.style.opacity = '0.9';
    } else {
        const pct = shieldCooldown > 0 ? Math.max(0, Math.min(1, 1 - shieldCooldown / SHIELD_COOLDOWN)) : 1;
        fill.style.width = `${Math.floor(pct * 100)}%`;
        fill.style.background = shieldCooldown > 0 ? 'linear-gradient(90deg,#888,#444)' : 'linear-gradient(90deg,#4efc9a,#08f)';
        shieldBtn.style.opacity = shieldCooldown > 0 ? '0.6' : '1';
    }
}

function updateScoreUI() {
    const el = $(elements.scoreId);
    if (el) el.innerText = `Score: ${score}`;
}

function updateTimerUI() {
    const el = $(elements.timerId);
    if (!el) return;
    const sec = Math.floor(sessionSeconds);
    el.innerText = `Tiempo: ${sec}s`;
}

function updateStreakUI() {
    const el = $(elements.streakId);
    if (!el) return;
    const streak = Number(localStorage.getItem('gp_streak') || 0);
    el.innerText = `Racha días: ${streak}`;
}

// when session ends, update consecutive day streak in localStorage
function commitDailyStreak() {
    try {
        const last = localStorage.getItem('gp_last_date');
        const today = new Date();
        const todayStr = today.toISOString().slice(0,10);
        if (last === todayStr) {
            // already recorded today - do nothing
            return;
        }
        const yesterday = new Date(today);
        yesterday.setDate(today.getDate() - 1);
        const ystr = yesterday.toISOString().slice(0,10);
        let streak = Number(localStorage.getItem('gp_streak') || 0);
        if (last === ystr) {
            streak = streak + 1;
        } else {
            streak = 1;
        }
        localStorage.setItem('gp_streak', String(streak));
        localStorage.setItem('gp_last_date', todayStr);
    } catch (e) {}
}

function playSound(buffer, loop = false) {
    return assetsModule.playSound(buffer, loop);
}

// Shooting
function shoot() {
    const now = Date.now();
    if (now - player.lastShot > player.shootDelay) {
        // small yellow bullet for visual/legacy
        player.bullets.push({
            x: player.x + player.width - 10,
            y: player.y + player.height / 2,
            speed: 10,
            radius: 4
        });

        // spawn some counter-missiles (as before)
        const spawnX = player.x + player.width / 2 + (Math.random() - 0.5) * 60;
        counterMissiles.push({
            x: spawnX,
            y: -30,
            speed: 6,
            turnSpeed: 0.08,
            life: 8
        });

        // spawn a player-fired homing missile that targets nearest pug/plane enemy
        // find nearest eligible enemy
        let nearest = null;
        let nd = 1e9;
        enemies.forEach(en => {
            // target planes, generals or missiles (we prefer dogs/planes)
            if (en.type === 'plane' || en.type === 'general' || en.isMissile) {
                const dx = (en.x + (en.width||30)/2) - (player.x + player.width/2);
                const dy = (en.y + (en.height||30)/2) - (player.y + player.height/2);
                const d = Math.hypot(dx, dy);
                if (d < nd) { nd = d; nearest = en; }
            }
        });

        playerMissiles.push({
            x: player.x + player.width,
            y: player.y + player.height / 2,
            speed: 8,
            turnSpeed: 0.12,
            angle: 0,
            target: nearest || null,
            radius: 6
        });

        player.lastShot = now;
        playSound(assetsModule.sounds.shoot);
    }
}

 // Shield
 function activateShield() {
     if (!gameRunning) return;
     if (shieldCooldown > 0 || shieldActive) return;
     shieldActive = true;
     shieldTime = SHIELD_DURATION;
     shieldCooldown = SHIELD_COOLDOWN;
     updateShieldUI();
     if (!assetsModule.isMuted()) playSound(assetsModule.sounds.meow);
 }

 // Send a letter (carta) - slower projectile that damages enemies on hit
 // If a multiplayer channel is available, broadcast the letter so a remote friend can receive it.
 function sendLetter() {
     if (!gameRunning) return;
     // add a small cooldown by reusing lastShot with longer delay
     const now = Date.now();
     if (now - player.lastShot < 500) return;
     player.lastShot = now;

     // local letter spawn (also used for individual airplane mode)
     const spawnLocalLetter = (opts = {}) => {
         letters.push({
             x: opts.x !== undefined ? opts.x : player.x + player.width,
             y: opts.y !== undefined ? opts.y : player.y + player.height / 2,
             speed: opts.speed || 5,
             width: 26,
             height: 16,
             remote: !!opts.remote,
             from: opts.from || null
         });
         if (!assetsModule.isMuted()) playSound(assetsModule.sounds.meow);
     };

     // If we have a multiplayer channel, broadcast the letter request for remote players.
     if (mpChannel) {
         try {
             mpChannel.postMessage({
                 type: 'letter',
                 from: playerId,
                 payload: {
                     // include a suggested spawn position relative to sender's playfield (normalized)
                     nx: (player.y + player.height/2) / (canvas.height || 1)
                 }
             });
             // also spawn locally so sender sees their own letter
             spawnLocalLetter();
         } catch (e) {
             // fallback to local spawn on error
             spawnLocalLetter();
         }
     } else {
         // no multiplayer available: individual airplane mode -> spawn locally
         spawnLocalLetter();
     }
 }

 // Sword (melee)
 function swingSword() {
     if (!gameRunning) return;
     if (swordActive) return;
     swordActive = true;
     swordTime = SWORD_DURATION;
     // play a meow/stab sound if available
     if (!assetsModule.isMuted()) playSound(assetsModule.sounds.meow);
     // immediately apply damage to enemies in range
     const px = player.x + player.width / 2;
     const py = player.y + player.height / 2;
     enemies.forEach((e, idx) => {
         // only affect regular enemies and missiles and generals
         const ex = e.x + (e.width || 30) / 2;
         const ey = e.y + (e.height || 30) / 2;
         const dx = ex - px;
         const dy = ey - py;
         const dist = Math.hypot(dx, dy);
         // simple frontal check: enemy must be to the right of the player (in front)
         const inFront = ex > px - 20;
         if (dist < SWORD_RANGE && inFront) {
             // if general boss with health
             if (e.type === 'general') {
                 e.hp = (e.hp || 10) - SWORD_DAMAGE;
                 if (e.hp <= 0) {
                     createExplosion(ex, ey);
                     playSound(assetsModule.sounds.explosion);
                     score += 500;
                     enemies.splice(idx, 1);
                 }
             } else {
                 // instant kill for normal enemies / missiles
                 createExplosion(ex, ey);
                 playSound(assetsModule.sounds.explosion);
                 score += 30;
                 const eid = enemies.indexOf(e);
                 if (eid !== -1) enemies.splice(eid, 1);
             }
         }
     });
 }

// Game update/draw (mostly moved from original game.js)
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

function update(dt) {
    if (!gameRunning) return;
    const dts = dt * 0.001;

    if (shieldActive) {
        shieldTime -= dts;
        if (shieldTime <= 0) {
            shieldActive = false;
            shieldTime = 0;
        }
    } else {
        if (shieldCooldown > 0) {
            shieldCooldown -= dts;
            if (shieldCooldown < 0) shieldCooldown = 0;
        }
    }
    // sword timing
    if (swordActive) {
        swordTime -= dts;
        if (swordTime <= 0) {
            swordActive = false;
            swordTime = 0;
        }
    }

    updateShieldUI();

    score += Math.floor(dt * 0.01);
    updateScoreUI();

    handleKeyboard();

    // Move player (player 1)
    player.x += player.dx;
    player.y += player.dy;

    // Move local player 2 (arrow keys)
    secondPlayer.x += secondPlayer.dx;
    secondPlayer.y += secondPlayer.dy;

    // constrain second player
    secondPlayer.x = Math.max(0, Math.min(canvas.width - secondPlayer.width, secondPlayer.x));
    secondPlayer.y = Math.max(0, Math.min(canvas.height - secondPlayer.height, secondPlayer.y));

    // Constrain player
    player.x = Math.max(0, Math.min(canvas.width - player.width, player.x));
    player.y = Math.max(0, Math.min(canvas.height - player.height, player.y));

    // Update bullets
    player.bullets.forEach((b, i) => {
        b.x += b.speed;
        if (b.x > canvas.width) player.bullets.splice(i, 1);
    });

    // Update letters (cartas)
    letters.forEach((L, li) => {
        L.x += L.speed;
        // check collision with enemies
        enemies.forEach((e, ei) => {
            const ex = e.x, ey = e.y, ew = e.width || 30, eh = e.height || 30;
            if (L.x < ex + ew && L.x + L.width > ex && L.y < ey + eh && L.y + L.height > ey) {
                // apply damage or remove
                if (e.type === 'general') {
                    e.hp = (e.hp || 10) - 2;
                    if (e.hp <= 0) {
                        createExplosion(e.x + ew/2, e.y + eh/2);
                        playSound(assetsModule.sounds.explosion);
                        enemies.splice(ei, 1);
                        score += 250;
                    }
                } else {
                    createExplosion(e.x + ew/2, e.y + eh/2);
                    playSound(assetsModule.sounds.explosion);
                    const idx = enemies.indexOf(e);
                    if (idx !== -1) enemies.splice(idx, 1);
                    score += 40;
                }
                // letter consumed
                if (letters[li]) letters.splice(li, 1);
            }
        });

        if (L.x > canvas.width + 100) letters.splice(li, 1);
    });

    // session timer counting while running
    if (gameRunning) {
        sessionSeconds += dts;
        updateTimerUI();
    }

    // Update player-fired homing missiles
    playerMissiles.forEach((m, mi) => {
        // if target dead or removed, pick nearest enemy
        if (!m.target || enemies.indexOf(m.target) === -1) {
            let nearest = null;
            let nd = 1e9;
            enemies.forEach(en => {
                const dx = (en.x + (en.width||30)/2) - m.x;
                const dy = (en.y + (en.height||30)/2) - m.y;
                const d = Math.hypot(dx, dy);
                if (d < nd) { nd = d; nearest = en; }
            });
            m.target = nearest;
        }

        if (m.target) {
            const tx = m.target.x + (m.target.width || 30) / 2;
            const ty = m.target.y + (m.target.height || 30) / 2;
            const desired = Math.atan2(ty - m.y, tx - m.x);
            let diff = desired - m.angle;
            while (diff > Math.PI) diff -= Math.PI * 2;
            while (diff < -Math.PI) diff += Math.PI * 2;
            m.angle += diff * m.turnSpeed;
            m.x += Math.cos(m.angle) * m.speed;
            m.y += Math.sin(m.angle) * m.speed;

            // collision with target
            const dx = tx - m.x;
            const dy = ty - m.y;
            const dist = Math.hypot(dx, dy);
            if (dist < (m.radius + ((m.target.width||30)/2))) {
                const idx = enemies.indexOf(m.target);
                if (idx !== -1) {
                    createExplosion(m.x, m.y);
                    playSound(assetsModule.sounds.explosion);
                    // apply damage: generals take more, planes die
                    if (m.target.type === 'general') {
                        m.target.hp = (m.target.hp || 10) - 6;
                        if (m.target.hp <= 0) {
                            enemies.splice(idx, 1);
                            score += 500;
                        }
                    } else {
                        enemies.splice(idx, 1);
                        score += 80;
                    }
                }
                // destroy missile
                playerMissiles.splice(mi, 1);
                return;
            }
        } else {
            // fly straight if no target
            m.x += Math.cos(m.angle) * m.speed;
            m.y += Math.sin(m.angle) * m.speed;
        }

        // remove if off-screen
        if (m.x > canvas.width + 200 || m.x < -200 || m.y > canvas.height + 200 || m.y < -200) {
            playerMissiles.splice(mi, 1);
        }
    });

    // Spawn clouds
    if (Date.now() > nextCloudTime) {
        clouds.push({
            x: canvas.width,
            y: Math.random() * canvas.height,
            speed: 1 + Math.random() * 2,
            scale: 0.5 + Math.random() * 1.5,
            opacity: 0.3 + Math.random() * 0.5
        });
        nextCloudTime = Date.now() + 1000 + Math.random() * 2000;
    }

    // Update clouds
    clouds.forEach((c, i) => {
        c.x -= c.speed;
        if (c.x < -200) clouds.splice(i, 1);
    });

    // Spawn enemies (occasionally spawn a "general" boss)
    if (Date.now() > nextEnemyTime) {
        const r = Math.random();
        if (r < 0.06) {
            // general boss - the pug general
            enemies.push({
                x: canvas.width + 220,
                y: 80 + Math.random() * (canvas.height - 160),
                width: 220,
                height: 180,
                speed: 4.0 + Math.random() * 2.0,
                type: 'general',
                hp: 12
            });
            nextEnemyTime = Date.now() + 12000 + Math.random() * 6000;
        } else if (r < 0.52) {
            enemies.push({
                x: canvas.width + 120,
                y: 40 + Math.random() * (canvas.height - 120),
                width: 90,
                height: 40,
                speed: 1.5 + Math.random() * 1.2,
                type: 'plane',
                fireCooldown: 1000 + Math.random() * 2000,
                lastFire: Date.now()
            });
            nextEnemyTime = Date.now() + 800 + Math.random() * 1200;
        } else {
            enemies.push({
                x: canvas.width + 50,
                y: Math.random() * (canvas.height - 40),
                width: 40,
                height: 14,
                // slowed down so missiles reach the cat a bit later
                speed: 2.5 + Math.random() * 2,
                turnSpeed: 0.02 + Math.random() * 0.03,
                angle: 0,
                isMissile: true
            });
            nextEnemyTime = Date.now() + Math.max(400, 1200 - (score * 10));
        }
    }

    // Update enemies and collisions
    enemies.forEach((e, ei) => {
        if (e.isMissile) {
            const targetX = player.x + player.width / 2;
            const targetY = player.y + player.height / 2;
            const dx = targetX - (e.x + e.width / 2);
            const dy = targetY - (e.y + e.height / 2);
            const desired = Math.atan2(dy, dx);
            let diff = desired - e.angle;
            while (diff > Math.PI) diff -= Math.PI * 2;
            while (diff < -Math.PI) diff += Math.PI * 2;
            e.angle += diff * e.turnSpeed;
            e.x += Math.cos(e.angle) * e.speed;
            e.y += Math.sin(e.angle) * e.speed;
        } else if (e.type === 'plane') {
            e.x -= e.speed;
            if (Date.now() - e.lastFire > e.fireCooldown) {
                e.lastFire = Date.now();
                const mx = e.x;
                const my = e.y + e.height / 2;
                enemies.push({
                    x: mx - 10,
                    y: my,
                    width: 40,
                    height: 14,
                    // slightly reduced firing missile speed for easier reaction
                    speed: 2.5 + Math.random() * 1.5,
                    turnSpeed: 0.02 + Math.random() * 0.03,
                    angle: Math.atan2((player.y + player.height/2) - my, (player.x + player.width/2) - mx),
                    isMissile: true
                });
            }
        } else {
            e.x -= e.speed || 2;
        }

        // Shield collision
        if (shieldActive) {
            const px = player.x + player.width / 2;
            const py = player.y + player.height / 2;
            const sx = e.x + e.width / 2;
            const sy = e.y + e.height / 2;
            const dist = Math.hypot(px - sx, py - sy);
            const shieldRadius = Math.max(player.width, player.height) * 0.75;
            if (dist < shieldRadius) {
                enemies.splice(ei, 1);
                createExplosion(sx, sy);
                playSound(assetsModule.sounds.explosion);
                score += 50;
                return;
            }
        }

        // Sword active: simple melee hit check (short window handled elsewhere too)
        if (swordActive) {
            const px = player.x + player.width / 2;
            const py = player.y + player.height / 2;
            const ex = e.x + (e.width || 30) / 2;
            const ey = e.y + (e.height || 30) / 2;
            const dx = ex - px;
            const dy = ey - py;
            const dist = Math.hypot(dx, dy);
            const inFront = ex > px - 20;
            if (dist < SWORD_RANGE && inFront) {
                if (e.type === 'general') {
                    e.hp = (e.hp || 10) - SWORD_DAMAGE;
                    if (e.hp <= 0) {
                        createExplosion(ex, ey);
                        playSound(assetsModule.sounds.explosion);
                        score += 500;
                        enemies.splice(ei, 1);
                        return;
                    }
                } else {
                    createExplosion(ex, ey);
                    playSound(assetsModule.sounds.explosion);
                    score += 30;
                    enemies.splice(ei, 1);
                    return;
                }
            }
        }

        // Player collision
        if (player.x < e.x + e.width && player.x + player.width > e.x &&
            player.y < e.y + e.height && player.y + player.height > e.y) {
            enemies.splice(ei, 1);
            createExplosion(player.x + player.width/2, player.y + player.height/2);
            if (!shieldActive) {
                lives--;
                updateLivesUI();
                playSound(assetsModule.sounds.explosion);
                if (lives <= 0) endGame();
            } else {
                playSound(assetsModule.sounds.explosion);
                score += 30;
            }
        }

        if (e.x < -300 || e.x > canvas.width + 300 || e.y < -200 || e.y > canvas.height + 200) enemies.splice(ei, 1);
    });

    // Update counter-missiles
    counterMissiles.forEach((cm, cmi) => {
        cm.life -= dt * 0.001;
        let nearest = null;
        let nearestDist = 1e9;
        enemies.forEach(en => {
            if (!en.isMissile) return;
            const dx = (en.x + en.width/2) - cm.x;
            const dy = (en.y + en.height/2) - cm.y;
            const d = Math.hypot(dx, dy);
            if (d < nearestDist) {
                nearestDist = d;
                nearest = en;
            }
        });

        if (nearest) {
            const desired = Math.atan2((nearest.y + nearest.height/2) - cm.y, (nearest.x + nearest.width/2) - cm.x);
            const vx = Math.cos(desired) * cm.speed;
            const vy = Math.sin(desired) * cm.speed;
            cm.x += vx;
            cm.y += vy;

            if (cm.x > nearest.x && cm.x < nearest.x + nearest.width && cm.y > nearest.y && cm.y < nearest.y + nearest.height) {
                const idx = enemies.indexOf(nearest);
                if (idx !== -1) enemies.splice(idx, 1);
                createExplosion(cm.x, cm.y);
                playSound(assetsModule.sounds.explosion);
                counterMissiles.splice(cmi, 1);
            }
        } else {
            cm.y += cm.speed;
        }

        if (cm.y > canvas.height + 200 || cm.x < -200 || cm.x > canvas.width + 200 || cm.life <= 0) {
            counterMissiles.splice(cmi, 1);
        }
    });

    // Particles
    particles.forEach((p, i) => {
        p.x += p.vx;
        p.y += p.vy;
        p.life -= 0.02;
        if (p.life <= 0) particles.splice(i, 1);
    });
}

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw clouds
    clouds.forEach(c => {
        ctx.globalAlpha = c.opacity;
        ctx.drawImage(assetsModule.images.cloud, c.x, c.y, 200 * c.scale, 100 * c.scale);
    });
    ctx.globalAlpha = 1.0;

    // Particles
    particles.forEach(p => {
        ctx.globalAlpha = p.life;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
        ctx.fill();
    });
    ctx.globalAlpha = 1.0;

    // Bullets
    ctx.fillStyle = '#ffff00';
    player.bullets.forEach(b => {
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
        ctx.fill();
    });

    // Player
    ctx.save();
    ctx.translate(player.x + player.width / 2, player.y + player.height / 2);
    ctx.rotate(player.angle);

    const r = 15;
    const w = player.width;
    const h = player.height;
    ctx.beginPath();
    ctx.moveTo(-w/2 + r, -h/2);
    ctx.lineTo(w/2 - r, -h/2);
    ctx.quadraticCurveTo(w/2, -h/2, w/2, -h/2 + r);
    ctx.lineTo(w/2, h/2 - r);
    ctx.quadraticCurveTo(w/2, h/2, w/2 - r, h/2);
    ctx.lineTo(-w/2 + r, h/2);
    ctx.quadraticCurveTo(-w/2, h/2, -w/2, h/2 - r);
    ctx.lineTo(-w/2, -h/2 + r);
    ctx.quadraticCurveTo(-w/2, -h/2, -w/2 + r, -h/2);
    ctx.closePath();
    ctx.clip();

    ctx.drawImage(assetsModule.images.player, -player.width / 2, -player.height / 2, player.width, player.height);

    if (assetsModule.images.catFace) {
        const faceW = player.width * 0.5;
        const faceH = player.height * 0.5;
        const faceX = -player.width * 0.1 - faceW / 2;
        const faceY = -faceH / 2;
        ctx.drawImage(assetsModule.images.catFace, faceX, faceY, faceW, faceH);
    }

    ctx.restore();

    // Draw second/local player (arrow-key controlled)
    ctx.save();
    ctx.translate(secondPlayer.x + secondPlayer.width / 2, secondPlayer.y + secondPlayer.height / 2);
    ctx.rotate(secondPlayer.angle);
    // simple rounded rect mask and draw smaller player sprite
    const sw = secondPlayer.width;
    const sh = secondPlayer.height;
    const sr = 10;
    ctx.beginPath();
    ctx.moveTo(-sw/2 + sr, -sh/2);
    ctx.lineTo(sw/2 - sr, -sh/2);
    ctx.quadraticCurveTo(sw/2, -sh/2, sw/2, -sh/2 + sr);
    ctx.lineTo(sw/2, sh/2 - sr);
    ctx.quadraticCurveTo(sw/2, sh/2, sw/2 - sr, sh/2);
    ctx.lineTo(-sw/2 + sr, sh/2);
    ctx.quadraticCurveTo(-sw/2, sh/2, -sw/2, sh/2 - sr);
    ctx.lineTo(-sw/2, -sh/2 + sr);
    ctx.quadraticCurveTo(-sw/2, -sh/2, -sw/2 + sr, -sh/2);
    ctx.closePath();
    ctx.clip();
    // draw using same player image scaled down (tint with globalAlpha for distinction)
    ctx.globalAlpha = 0.95;
    ctx.drawImage(assetsModule.images.player, -sw/2, -sh/2, sw, sh);
    ctx.globalAlpha = 1.0;
    ctx.restore();

    // Shield glow
    if (shieldActive) {
        ctx.save();
        ctx.globalAlpha = 0.35;
        ctx.strokeStyle = '#66ffff';
        ctx.lineWidth = 10;
        const cx = player.x + player.width / 2;
        const cy = player.y + player.height / 2;
        const rad = Math.max(player.width, player.height) * 0.75;
        ctx.beginPath();
        ctx.arc(cx, cy, rad, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
    }

    // Enemies
    enemies.forEach(e => {
        if (e.isMissile) {
            ctx.save();
            const cx = e.x + e.width / 2;
            const cy = e.y + e.height / 2;
            ctx.translate(cx, cy);
            ctx.rotate(e.angle);
            ctx.fillStyle = '#8b8b8b';
            ctx.fillRect(-e.width/2, -e.height/2, e.width, e.height);
            ctx.beginPath();
            ctx.moveTo(e.width/2, 0);
            ctx.lineTo(e.width/2 + e.height, -e.height);
            ctx.lineTo(e.width/2 + e.height, e.height);
            ctx.closePath();
            ctx.fillStyle = '#b33';
            ctx.fill();
            ctx.fillStyle = '#444';
            ctx.beginPath();
            ctx.moveTo(-e.width/2 + 2, e.height/2);
            ctx.lineTo(-e.width/2 - (e.height), e.height/2 + (e.height/1.5));
            ctx.lineTo(-e.width/2 + 8, e.height/2);
            ctx.closePath();
            ctx.fill();
            ctx.beginPath();
            ctx.moveTo(-e.width/2 + 2, -e.height/2);
            ctx.lineTo(-e.width/2 - (e.height), -e.height/2 - (e.height/1.5));
            ctx.lineTo(-e.width/2 + 8, -e.height/2);
            ctx.closePath();
            ctx.fill();
            ctx.restore();
        } else if (e.type === 'general') {
            // draw general pug boss
            const img = assetsModule.images.general || assetsModule.images.dog || assetsModule.images.enemy;
            ctx.save();
            // make boss slightly pulsing
            const pulse = 1 + Math.sin(Date.now() * 0.005) * 0.03;
            ctx.translate(e.x + e.width/2, e.y + e.height/2);
            ctx.scale(pulse, pulse);
            ctx.drawImage(img, -e.width/2, -e.height/2, e.width, e.height);
            // draw HP bar
            ctx.restore();
            ctx.fillStyle = 'rgba(0,0,0,0.6)';
            const barW = Math.min(200, e.width);
            const barX = e.x + e.width/2 - barW/2;
            const barY = e.y - 10;
            ctx.fillRect(barX, barY, barW, 8);
            ctx.fillStyle = '#ff4d4d';
            const hpPct = (e.hp || 1) / 12;
            ctx.fillRect(barX, barY, barW * Math.max(0, hpPct), 8);
        } else {
            // draw dog enemy if available, fall back to enemy image
            const img = assetsModule.images.dog || assetsModule.images.enemy;
            ctx.drawImage(img, e.x, e.y, e.width, e.height);
        }
    });

    // Draw player-fired missiles
    playerMissiles.forEach(m => {
        ctx.save();
        ctx.translate(m.x, m.y);
        ctx.rotate(m.angle);
        // missile body
        ctx.fillStyle = '#2cf';
        ctx.fillRect(-8, -4, 16, 8);
        // tip
        ctx.beginPath();
        ctx.moveTo(8, 0);
        ctx.lineTo(12, -6);
        ctx.lineTo(12, 6);
        ctx.closePath();
        ctx.fillStyle = '#0a9';
        ctx.fill();
        ctx.restore();
    });

    // Letters (cartas)
    letters.forEach(L => {
        ctx.save();
        ctx.translate(L.x, L.y);
        ctx.fillStyle = '#fff';
        ctx.fillRect(-L.width/2, -L.height/2, L.width, L.height);
        ctx.strokeStyle = '#c33';
        ctx.strokeRect(-L.width/2, -L.height/2, L.width, L.height);
        // envelope flap
        ctx.beginPath();
        ctx.moveTo(-L.width/2, -L.height/2);
        ctx.lineTo(0, 0);
        ctx.lineTo(L.width/2, -L.height/2);
        ctx.closePath();
        ctx.fillStyle = '#f66';
        ctx.fill();
        ctx.restore();
    });

    // Counter missiles
    counterMissiles.forEach(cm => {
        ctx.save();
        ctx.translate(cm.x, cm.y);
        ctx.fillStyle = '#e33';
        ctx.beginPath();
        ctx.moveTo(0, -6);
        ctx.lineTo(6, 6);
        ctx.lineTo(-6, 6);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#333';
        ctx.fillRect(-3, 6, 6, 8);
        ctx.restore();
    });
}

function loop(timestamp) {
    const dt = timestamp - lastTime;
    lastTime = timestamp;
    update(dt);
    draw();
    requestAnimationFrame(loop);
}

function startGame() {
    if (assetsModule.audioCtx.state === 'suspended') {
        assetsModule.audioCtx.resume();
    }

    score = 0;
    lives = 5;
    enemies = [];
    player.bullets = [];
    clouds = [];
    counterMissiles = [];
    letters = [];
    sessionSeconds = 0;
    updateScoreUI();
    updateLivesUI();
    updateTimerUI();
    updateStreakUI();

    $(elements.startScreenId).classList.add('hidden');
    $(elements.gameOverId).classList.add('hidden');
    gameRunning = true;

    if (!assetsModule.isMuted()) playSound(assetsModule.sounds.meow);
    if (engineSoundSource) try { engineSoundSource.stop(); } catch(e){}
    engineSoundSource = playSound(assetsModule.sounds.engine, true);
}

function endGame() {
    gameRunning = false;
    $(elements.gameOverId).classList.remove('hidden');
    $(elements.finalScoreId).innerText = `Puntaje Final: ${score}`;
    // commit daily streak/persistence
    commitDailyStreak();
    updateStreakUI();
    if (engineSoundSource) {
        try { engineSoundSource.stop(); } catch(e){}
        engineSoundSource = null;
    }
}

// public init
export function init(opts) {
    elements = opts;
    canvas = document.getElementById(opts.canvasId);
    ctx = canvas.getContext('2d');

    // attach gender state and UI wiring
    // default gender symbol uses ⚧ (unselected) then set to chosen symbol
    player.gender = 'unknown';
    secondPlayer.gender = 'unknown';

    function setPlayerGender(pIdx, sym) {
        if (pIdx === 1) {
            player.gender = sym;
            const el = document.getElementById('p1-gender-display');
            if (el) el.textContent = sym;
        } else {
            secondPlayer.gender = sym;
            const el = document.getElementById('p2-gender-display');
            if (el) el.textContent = sym;
        }
    }

    // wire start-screen gender buttons if present
    const map = [
        { id: 'p1-gender-m', p:1, sym:'♂️' },
        { id: 'p1-gender-f', p:1, sym:'♀️' },
        { id: 'p2-gender-m', p:2, sym:'♂️' },
        { id: 'p2-gender-f', p:2, sym:'♀️' }
    ];
    map.forEach(it => {
        const btn = document.getElementById(it.id);
        if (btn) {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                setPlayerGender(it.p, it.sym);
                // small visual toggle: highlight selected
                // clear siblings
                const prefix = it.id.slice(0,3); // p1- or p2-
                ['m','f'].forEach(s => {
                    const sib = document.getElementById(prefix + 'gender-' + s);
                    if (sib) sib.style.outline = (sib === btn) ? '2px solid #fff' : 'none';
                });
            });
        }
    });

    // initialize HUD displays (if elements exist)
    setTimeout(() => {
        const p1disp = document.getElementById('p1-gender-display');
        if (p1disp) p1disp.textContent = player.gender === 'unknown' ? '⚧' : player.gender;
        const p2disp = document.getElementById('p2-gender-display');
        if (p2disp) p2disp.textContent = secondPlayer.gender === 'unknown' ? '⚧' : secondPlayer.gender;
    }, 10);

    assetsModule = null;
    import('./assets.js').then(m => {
        assetsModule = m;
        return assetsModule.loadAssets();
    }).then(() => {
        // setup multiplayer channel (BroadcastChannel) to exchange simple messages with other open clients
        try {
            if ('BroadcastChannel' in window) {
                mpChannel = new BroadcastChannel('gp_multiplayer_channel');
                mpChannel.onmessage = (ev) => {
                    const msg = ev.data;
                    if (!msg || !msg.type) return;
                    if (msg.type === 'letter') {
                        // received a letter from a remote player: spawn a letter originating from right side
                        // use normalized y if provided
                        let y = canvas.height / 2;
                        if (msg.payload && typeof msg.payload.nx === 'number') {
                            y = (msg.payload.nx || 0.5) * canvas.height;
                        }
                        // spawn the incoming letter slightly offscreen left-to-right to simulate delivery
                        letters.push({
                            x: -50, // come from left side of this client's screen (friend sending to you)
                            y: y,
                            speed: 4.5,
                            width: 26,
                            height: 16,
                            remote: true,
                            from: msg.from || null
                        });
                        // play a distinct sound so player knows it's an incoming multiplayer letter
                        if (!assetsModule.isMuted()) playSound(assetsModule.sounds.meow);
                    }
                };
            }
        } catch (e) {
            mpChannel = null;
        }

        // wire controls/UI
        window.addEventListener('resize', resize);
        resize();

        // joystick & input
        setupJoystick(opts.joystickZoneId);
        setupKeyboard(shoot, activateShield, swingSword, sendLetter);

        // Send-letter button
        const sendBtn = document.getElementById(opts.sendLetterBtnId);
        if (sendBtn) {
            sendBtn.addEventListener('click', (e) => {
                e.preventDefault();
                sendLetter();
            });
            sendBtn.addEventListener('touchstart', (e) => {
                e.preventDefault();
                sendLetter();
            }, {passive:false});
        }

        // hook shoot button on mobile
        const shootBtn = document.getElementById(opts.shootBtnId);
        if (shootBtn) {
            shootBtn.addEventListener('touchstart', (e) => {
                e.preventDefault();
                if (gameRunning) shoot();
            }, {passive:false});
        }

        // shield button
        const shieldBtnEl = document.getElementById(opts.shieldBtnId);
        if (shieldBtnEl) {
            shieldBtnEl.addEventListener('click', (e) => {
                e.preventDefault();
                if (assetsModule.audioCtx.state === 'suspended') assetsModule.audioCtx.resume();
                activateShield();
            });
            shieldBtnEl.addEventListener('touchstart', (e) => {
                e.preventDefault();
                activateShield();
            }, {passive:false});
        }

        // volume button
        const volBtn = document.getElementById(opts.volumeBtnId);
        function updateVolButton() {
            if (!volBtn) return;
            volBtn.textContent = assetsModule.isMuted() ? '🔇' : '🔊';
        }
        if (volBtn) {
            volBtn.addEventListener('click', (e) => {
                e.preventDefault();
                if (assetsModule.audioCtx.state === 'suspended') assetsModule.audioCtx.resume();
                assetsModule.setMuted(!assetsModule.isMuted());
                // stop engine sound if muting
                if (assetsModule.isMuted() && engineSoundSource) {
                    try { engineSoundSource.stop(); } catch(e){}
                    engineSoundSource = null;
                } else if (!assetsModule.isMuted() && gameRunning && assetsModule.sounds.engine) {
                    engineSoundSource = playSound(assetsModule.sounds.engine, true);
                }
                updateVolButton();
            });
        }
        updateVolButton();

        // Start/restart handlers
        const startEl = document.getElementById(opts.startBtnId);
        const restartEl = document.getElementById(opts.restartBtnId);
        if (startEl) startEl.addEventListener('click', startGame);
        if (restartEl) restartEl.addEventListener('click', startGame);

        requestAnimationFrame(loop);
    });
}