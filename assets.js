/* assets.js */
export const ASSETS = {
    player: './enemy_plane.png',
    dog: './enemy_plane.png',           // fallback (usa el avión por ahora)
    general: './enemy_plane.png',       // fallback
    enemy: './enemy_plane.png',
    cloud: './cloud.png',
    catFace: './cat_face.png',
    engine: './engine.mp3',
    shoot: './shoot.mp3',
    explosion: './explosion.mp3',
    meow: './meow.mp3'
};

export const images = {};
export const sounds = {};
export const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

let _muted = false;
try {
    const saved = localStorage.getItem('gp_muted');
    if (saved !== null) _muted = saved === '1';
} catch (e) {}

export async function loadAssets() {
    const loadImg = (src) => new Promise((res, rej) => {
        const img = new Image();
        img.src = src;
        img.onload = () => res(img);
        img.onerror = () => {
            console.error("Error cargando:", src);
            rej(new Error("Failed to load " + src));
        };
    });

    const loadSound = async (src) => {
        const response = await fetch(src);
        const arrayBuffer = await response.arrayBuffer();
        return await audioCtx.decodeAudioData(arrayBuffer);
    };

    images.player = await loadImg(ASSETS.player);
    images.dog = await loadImg(ASSETS.dog);
    images.general = await loadImg(ASSETS.general);
    images.enemy = await loadImg(ASSETS.enemy);
    images.cloud = await loadImg(ASSETS.cloud);
    images.catFace = await loadImg(ASSETS.catFace);

    sounds.engine = await loadSound(ASSETS.engine);
    sounds.shoot = await loadSound(ASSETS.shoot);
    sounds.explosion = await loadSound(ASSETS.explosion);
    sounds.meow = await loadSound(ASSETS.meow);
}

export function playSound(buffer, loop = false) {
    if (_muted || !buffer) return null;
    const source = audioCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(audioCtx.destination);
    source.loop = loop;
    source.start(0);
    return source;
}

export function isMuted() { return _muted; }
export function setMuted(val) {
    _muted = !!val;
    try { localStorage.setItem('gp_muted', _muted ? '1' : '0'); } catch(e){}
}
