import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/* -------------------------------------------------------------------------- */
/*  A cabin built entirely from code.                                         */
/*  No imported models, no image assets — every mesh, texture and particle    */
/*  is generated at runtime.                                                  */
/* -------------------------------------------------------------------------- */

const TAU = Math.PI * 2;
const clamp = THREE.MathUtils.clamp;
const lerp = THREE.MathUtils.lerp;

function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function random() {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(20261018);
const randRange = (a, b) => a + (b - a) * rand();

function hash2(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

function valueNoise(x, y) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy);
  const b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1);
  const d = hash2(ix + 1, iy + 1);
  return lerp(lerp(a, b, ux), lerp(c, d, ux), uy);
}

function fbm(x, y, octaves = 4) {
  let value = 0;
  let amplitude = 0.5;
  let frequency = 1;
  for (let i = 0; i < octaves; i++) {
    value += valueNoise(x * frequency, y * frequency) * amplitude;
    frequency *= 2.03;
    amplitude *= 0.5;
  }
  return value;
}

function pathCenterX(z) {
  const t = clamp((z - 2.9) / 10.5, 0, 1);
  return 0.58 + Math.sin(t * 2.25) * 1.12 * t;
}

const POND = {
  x: -7.3,
  z: 9.0,
  r: 4.35,
  waterY: -0.16,
};

function terrainHeight(x, z) {
  const radius = Math.hypot(x, z);
  const clearing = smoothstep(5.4, 13.5, radius);
  let h = (fbm(x * 0.085 + 4.1, z * 0.085 - 2.3, 4) - 0.48) * 1.75;
  h += (fbm(x * 0.31, z * 0.31, 2) - 0.5) * 0.26;
  h *= clearing;
  h += smoothstep(18, 42, radius) * 0.8;

  // Hollow out the small fishing pond and blend its bank into the clearing.
  const pondDistance = Math.hypot(x - POND.x, z - POND.z);
  const basin = 1 - smoothstep(2.65, 4.15, pondDistance);
  if (basin > 0.001) {
    const depth = POND.waterY - 0.62 - 0.12 * (1 - smoothstep(0, 2.7, pondDistance));
    h = lerp(h, depth, basin);
  }

  // Raise a soft bank around the water so the pond always has a clean shoreline.
  const bank = smoothstep(3.55, 4.25, pondDistance) * (1 - smoothstep(4.8, 5.9, pondDistance));
  if (bank > 0.001) {
    h = Math.max(h, POND.waterY + 0.03 + 0.16 * bank);
  }
  return h;
}

/* -------------------------------------------------------------------------- */
/*  Renderer, camera, controls                                                */
/* -------------------------------------------------------------------------- */

const canvas = document.querySelector('#scene');
const IS_SMALL_SCREEN = Boolean(window.matchMedia && window.matchMedia('(max-width: 760px)').matches);
const TOUCH_INPUT = Boolean(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
const BITE_WINDOW = TOUCH_INPUT ? 2.35 : 1.85;
const PIXEL_RATIO_CAP = IS_SMALL_SCREEN ? 1.5 : 2;
let renderer;
try {
  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: 'high-performance',
  });
} catch (error) {
  document.querySelector('.loader-text').textContent = '当前浏览器无法启动 WebGL';
  throw error;
}

renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, PIXEL_RATIO_CAP));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.18;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x081110);
scene.fog = new THREE.FogExp2(0x0b1716, 0.0175);

const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 180);
function applyResponsiveFov() {
  const aspect = window.innerWidth / window.innerHeight;
  camera.fov = aspect < 0.8 ? 68 : aspect < 1.05 ? 52 : 42;
  camera.updateProjectionMatrix();
}
applyResponsiveFov();
const HOME_TARGET = new THREE.Vector3(-2.6, 3.1, 2.0);
const HOME_POSITION = new THREE.Vector3(13.8, 8.0, 22.0);
if (window.innerWidth / window.innerHeight < 0.8) {
  HOME_POSITION.sub(HOME_TARGET).multiplyScalar(1.22).add(HOME_TARGET);
}
camera.position.set(17.5, 10.5, 29.0);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.copy(HOME_TARGET);
controls.enableDamping = true;
controls.dampingFactor = 0.055;
controls.enablePan = true;
controls.screenSpacePanning = true;
controls.minDistance = 7.4;
controls.maxDistance = 36;
controls.minPolarAngle = 0.42;
controls.maxPolarAngle = Math.PI * 0.495;
controls.autoRotate = false;
controls.autoRotateSpeed = 0.34;
controls.update();

const maxAnisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());

/* -------------------------------------------------------------------------- */
/*  Procedural canvas textures                                                */
/* -------------------------------------------------------------------------- */

function canvasTexture(width, height, painter, options = {}) {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const ctx = c.getContext('2d');
  painter(ctx, width, height);
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = options.srgb === false ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  texture.wrapS = options.clamp ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
  texture.wrapT = options.clamp ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
  texture.anisotropy = maxAnisotropy;
  texture.needsUpdate = true;
  return texture;
}

function cloneTexture(texture, repeatX = 1, repeatY = 1) {
  const t = texture.clone();
  t.repeat.set(repeatX, repeatY);
  t.needsUpdate = true;
  return t;
}

function makeWoodTexture(vertical = false) {
  const random = mulberry32(vertical ? 1933 : 9177);
  const width = vertical ? 256 : 512;
  const height = vertical ? 512 : 256;
  return canvasTexture(width, height, (ctx, w, h) => {
    ctx.fillStyle = vertical ? '#6f462a' : '#70482d';
    ctx.fillRect(0, 0, w, h);

    const gradient = vertical
      ? ctx.createLinearGradient(0, 0, w, 0)
      : ctx.createLinearGradient(0, 0, 0, h);
    gradient.addColorStop(0, 'rgba(255,220,173,0.13)');
    gradient.addColorStop(0.45, 'rgba(255,218,170,0.02)');
    gradient.addColorStop(1, 'rgba(40,20,10,0.24)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);

    for (let i = 0; i < 145; i++) {
      const alpha = 0.05 + random() * 0.24;
      ctx.strokeStyle = random() > 0.48
        ? 'rgba(43,22,11,' + alpha.toFixed(3) + ')'
        : 'rgba(220,167,111,' + (alpha * 0.56).toFixed(3) + ')';
      ctx.lineWidth = 0.45 + random() * 1.45;
      ctx.beginPath();
      if (vertical) {
        const x = random() * w;
        const y = -20 + random() * h;
        const length = 80 + random() * (h * 0.7);
        ctx.moveTo(x, y);
        ctx.bezierCurveTo(x + random() * 11 - 5.5, y + length * 0.36, x + random() * 13 - 6.5, y + length * 0.7, x + random() * 7 - 3.5, y + length);
      } else {
        const x = -30 + random() * w;
        const y = random() * h;
        const length = 100 + random() * (w * 0.65);
        ctx.moveTo(x, y);
        ctx.bezierCurveTo(x + length * 0.34, y + random() * 9 - 4.5, x + length * 0.7, y + random() * 11 - 5.5, x + length, y + random() * 6 - 3);
      }
      ctx.stroke();
    }

    for (let i = 0; i < 7; i++) {
      const cx = random() * w;
      const cy = random() * h;
      const rx = 4 + random() * 9;
      const ry = 2 + random() * 5;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(random() * Math.PI);
      for (let ring = 0; ring < 4; ring++) {
        ctx.strokeStyle = 'rgba(48,25,13,' + (0.28 - ring * 0.045).toFixed(3) + ')';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.ellipse(0, 0, rx + ring * 3.2, ry + ring * 2.1, 0, 0, TAU);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(36,18,9,0.34)';
      ctx.beginPath();
      ctx.ellipse(0, 0, rx * 0.55, ry * 0.5, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
    }

    for (let i = 0; i < 95; i++) {
      ctx.fillStyle = 'rgba(255,229,188,' + (0.018 + random() * 0.04).toFixed(3) + ')';
      ctx.fillRect(random() * w, random() * h, 1 + random() * 12, 1);
    }
  });
}

function makeShingleTexture() {
  const random = mulberry32(4421);
  return canvasTexture(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#2b1f17';
    ctx.fillRect(0, 0, w, h);

    const rows = 9;
    const rowH = h / rows;
    const tileW = 72;
    for (let row = 0; row < rows; row++) {
      const y = row * rowH;
      const offset = row % 2 === 0 ? -tileW * 0.5 : 0;
      for (let x = offset; x < w + tileW; x += tileW) {
        const shade = 0.72 + random() * 0.55;
        const r = Math.floor(66 * shade);
        const g = Math.floor(45 * shade);
        const b = Math.floor(32 * shade);
        ctx.fillStyle = 'rgb(' + r + ',' + g + ',' + b + ')';
        ctx.fillRect(x + 2, y + 2, tileW - 4, rowH - 3);

        const gl = ctx.createLinearGradient(0, y, 0, y + rowH);
        gl.addColorStop(0, 'rgba(255,220,170,0.10)');
        gl.addColorStop(0.25, 'rgba(255,220,170,0.00)');
        gl.addColorStop(1, 'rgba(0,0,0,0.22)');
        ctx.fillStyle = gl;
        ctx.fillRect(x + 2, y + 2, tileW - 4, rowH - 3);

        ctx.strokeStyle = 'rgba(12,8,6,0.56)';
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 1, y + 1, tileW - 2, rowH - 1);
        ctx.strokeStyle = 'rgba(255,208,155,0.08)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x + 4, y + 4);
        ctx.lineTo(x + tileW - 5, y + 4);
        ctx.stroke();

        for (let i = 0; i < 4; i++) {
          ctx.strokeStyle = 'rgba(30,17,10,' + (0.12 + random() * 0.12).toFixed(3) + ')';
          ctx.beginPath();
          const sx = x + 8 + random() * (tileW - 16);
          const sy = y + 8 + random() * (rowH - 16);
          ctx.moveTo(sx, sy);
          ctx.lineTo(sx + random() * 15 - 7, sy + 2 + random() * 10);
          ctx.stroke();
        }
      }
    }

    for (let i = 0; i < 28; i++) {
      const x = random() * w;
      const y = random() * h;
      const radius = 6 + random() * 30;
      const moss = ctx.createRadialGradient(x, y, 0, x, y, radius);
      moss.addColorStop(0, 'rgba(80,96,51,' + (0.2 + random() * 0.2).toFixed(3) + ')');
      moss.addColorStop(1, 'rgba(80,96,51,0)');
      ctx.fillStyle = moss;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, TAU);
      ctx.fill();
    }

    for (let i = 0; i < 1600; i++) {
      ctx.fillStyle = 'rgba(220,196,160,' + (0.015 + random() * 0.045).toFixed(3) + ')';
      ctx.fillRect(random() * w, random() * h, 1 + random() * 3, 1);
    }
  });
}

function makeStoneTexture() {
  const random = mulberry32(6127);
  return canvasTexture(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#77746b';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 120; i++) {
      const x = random() * w;
      const y = random() * h;
      const radius = 8 + random() * 52;
      const shade = 92 + Math.floor(random() * 58);
      const warm = random() > 0.5 ? 6 : -2;
      const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
      g.addColorStop(0, 'rgba(' + (shade + warm) + ',' + (shade + 2) + ',' + (shade - 7) + ',0.32)');
      g.addColorStop(1, 'rgba(' + (shade + warm) + ',' + (shade + 2) + ',' + (shade - 7) + ',0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, TAU);
      ctx.fill();
    }
    for (let i = 0; i < 48; i++) {
      ctx.strokeStyle = 'rgba(38,36,32,' + (0.08 + random() * 0.18).toFixed(3) + ')';
      ctx.lineWidth = 0.6 + random() * 1.4;
      ctx.beginPath();
      let x = random() * w;
      let y = random() * h;
      ctx.moveTo(x, y);
      for (let k = 0; k < 4; k++) {
        x += random() * 40 - 20;
        y += random() * 34 - 17;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    for (let i = 0; i < 18; i++) {
      const x = random() * w;
      const y = random() * h;
      const r = 8 + random() * 24;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(88,104,59,0.24)');
      g.addColorStop(1, 'rgba(88,104,59,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.fill();
    }
    for (let i = 0; i < 1900; i++) {
      ctx.fillStyle = 'rgba(236,230,213,' + (0.015 + random() * 0.05).toFixed(3) + ')';
      ctx.fillRect(random() * w, random() * h, 1, 1);
    }
  });
}

function makeGroundTexture() {
  const random = mulberry32(7781);
  return canvasTexture(256, 256, (ctx, w, h) => {
    const image = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const n = fbm(x * 0.075, y * 0.075, 3);
        const speck = random();
        const value = clamp(205 + n * 34 + (speck - 0.5) * 30, 150, 255);
        const i = (y * w + x) * 4;
        image.data[i] = value * 0.96;
        image.data[i + 1] = value;
        image.data[i + 2] = value * 0.84;
        image.data[i + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);
    for (let i = 0; i < 60; i++) {
      ctx.strokeStyle = 'rgba(62,70,38,' + (0.03 + random() * 0.09).toFixed(3) + ')';
      ctx.lineWidth = 0.5 + random() * 1.3;
      ctx.beginPath();
      const x = random() * w;
      const y = random() * h;
      ctx.moveTo(x, y);
      ctx.lineTo(x + random() * 7 - 3.5, y + 3 + random() * 7);
      ctx.stroke();
    }
  });
}

const glowTexture = canvasTexture(128, 128, (ctx, w, h) => {
  const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.18, 'rgba(255,247,225,0.92)');
  g.addColorStop(0.43, 'rgba(255,202,139,0.3)');
  g.addColorStop(0.72, 'rgba(255,174,91,0.05)');
  g.addColorStop(1, 'rgba(255,150,60,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}, { clamp: true });

const signTextTexture = canvasTexture(512, 208, (ctx, w, h) => {
  ctx.clearRect(0, 0, w, h);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(30,20,12,0.72)';
  ctx.font = '600 82px "Songti SC","STSong","Microsoft YaHei",serif';
  ctx.fillText('林间小屋', w / 2 + 2, h / 2 - 12);
  ctx.fillStyle = '#efd7ad';
  ctx.fillText('林间小屋', w / 2, h / 2 - 14);
  ctx.font = '500 17px "Georgia",serif';
  ctx.fillStyle = 'rgba(235,210,171,0.76)';
  ctx.fillText('W O O D L A N D   C A B I N', w / 2, h - 42);
  ctx.strokeStyle = 'rgba(235,210,171,0.36)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(90, h - 22);
  ctx.lineTo(w - 90, h - 22);
  ctx.stroke();
}, { clamp: true });

const woodTexture = makeWoodTexture(false);
const verticalWoodTexture = makeWoodTexture(true);
const shingleTexture = makeShingleTexture();
const stoneTexture = makeStoneTexture();
const groundTexture = makeGroundTexture();

shingleTexture.repeat.set(4.6, 2.1);
stoneTexture.repeat.set(2.2, 1.3);
groundTexture.repeat.set(22, 22);

/* -------------------------------------------------------------------------- */
/*  Materials                                                                 */
/* -------------------------------------------------------------------------- */

function woodMaterial(texture, repeatX, repeatY, color = 0xffffff, extra = {}) {
  const map = cloneTexture(texture, repeatX, repeatY);
  return new THREE.MeshStandardMaterial({
    map,
    color,
    roughness: 0.9,
    metalness: 0,
    ...extra,
  });
}

const MAT = {
  logSides: [
    woodMaterial(verticalWoodTexture, 1, 1.35, 0xffffff),
    woodMaterial(verticalWoodTexture, 1, 1.15, 0xe8c9aa),
    woodMaterial(verticalWoodTexture, 1, 1.6, 0xd8b394),
  ],
  logEnd: new THREE.MeshStandardMaterial({
    map: cloneTexture(verticalWoodTexture, 0.8, 0.8),
    color: 0xd9b586,
    roughness: 0.86,
  }),
  beam: woodMaterial(woodTexture, 1.3, 1, 0x6d4a30, { roughness: 0.94 }),
  darkBeam: woodMaterial(verticalWoodTexture, 1, 1, 0x5e4430, { roughness: 0.94 }),
  plank: woodMaterial(woodTexture, 2.1, 1, 0xf0d6b8),
  doorPlank: woodMaterial(verticalWoodTexture, 0.9, 1, 0xc99868),
  deck: woodMaterial(woodTexture, 2.4, 1, 0xc49a70),
  trim: woodMaterial(woodTexture, 1.5, 1, 0x5b3d26, { roughness: 0.92 }),
  shutter: woodMaterial(woodTexture, 1, 1.2, 0x354a38, { roughness: 0.92 }),
  roofSide: woodMaterial(woodTexture, 1.2, 1, 0x3c2a1e, { roughness: 0.96 }),
  roofTop: new THREE.MeshStandardMaterial({
    map: shingleTexture,
    color: 0xffffff,
    roughness: 0.97,
    metalness: 0,
  }),
  roofUnder: new THREE.MeshStandardMaterial({ color: 0x211711, roughness: 1 }),
  stone: new THREE.MeshStandardMaterial({
    map: cloneTexture(stoneTexture, 1.4, 1),
    color: 0xffffff,
    roughness: 1,
    flatShading: true,
  }),
  stoneDark: new THREE.MeshStandardMaterial({
    map: cloneTexture(stoneTexture, 1, 1),
    color: 0x9c978a,
    roughness: 1,
    flatShading: true,
  }),
  stoneLight: new THREE.MeshStandardMaterial({
    color: 0x9d998d,
    roughness: 0.98,
    flatShading: true,
  }),
  bark: new THREE.MeshStandardMaterial({
    map: cloneTexture(verticalWoodTexture, 1.2, 2.7),
    color: 0x806b52,
    roughness: 1,
    flatShading: true,
  }),
  birch: new THREE.MeshStandardMaterial({ color: 0xb7ab94, roughness: 0.94, flatShading: true }),
  moss: new THREE.MeshStandardMaterial({ color: 0x4d5d35, roughness: 1, flatShading: true }),
  mossLight: new THREE.MeshStandardMaterial({ color: 0x637848, roughness: 1, flatShading: true }),
  foliage: [
    new THREE.MeshStandardMaterial({ color: 0x2b4635, roughness: 0.94, flatShading: true }),
    new THREE.MeshStandardMaterial({ color: 0x35543c, roughness: 0.94, flatShading: true }),
    new THREE.MeshStandardMaterial({ color: 0x254134, roughness: 0.95, flatShading: true }),
    new THREE.MeshStandardMaterial({ color: 0x3d5c42, roughness: 0.93, flatShading: true }),
  ],
  gold: [
    new THREE.MeshStandardMaterial({ color: 0xa97a31, roughness: 0.9, flatShading: true }),
    new THREE.MeshStandardMaterial({ color: 0xc08e3d, roughness: 0.9, flatShading: true }),
    new THREE.MeshStandardMaterial({ color: 0x8d6327, roughness: 0.92, flatShading: true }),
    new THREE.MeshStandardMaterial({ color: 0xb57f2f, roughness: 0.9, flatShading: true }),
  ],
  glass: new THREE.MeshStandardMaterial({
    color: 0xffc478,
    emissive: 0xff8129,
    emissiveIntensity: 2.25,
    roughness: 0.26,
    metalness: 0,
  }),
  doorGlow: new THREE.MeshBasicMaterial({
    color: 0xffa24b,
    transparent: true,
    opacity: 0.88,
    toneMapped: false,
  }),
  iron: new THREE.MeshStandardMaterial({ color: 0x211d19, roughness: 0.48, metalness: 0.7 }),
  brass: new THREE.MeshStandardMaterial({ color: 0xb08a4e, roughness: 0.28, metalness: 0.82 }),
  fabric: new THREE.MeshStandardMaterial({ color: 0x6e3e33, roughness: 1 }),
  mushroomCap: new THREE.MeshStandardMaterial({ color: 0xb64c32, roughness: 0.8 }),
  mushroomStem: new THREE.MeshStandardMaterial({ color: 0xd8c8a8, roughness: 0.95 }),
  mushroomSpot: new THREE.MeshStandardMaterial({ color: 0xf0dfbb, roughness: 0.8 }),
  flowerWhite: new THREE.MeshStandardMaterial({ color: 0xf1e8cf, roughness: 0.72, emissive: 0x403620, emissiveIntensity: 0.25 }),
  flowerGold: new THREE.MeshStandardMaterial({ color: 0xe7c36c, roughness: 0.72, emissive: 0x4a340c, emissiveIntensity: 0.25 }),
  grass: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, side: THREE.DoubleSide }),
  fern: new THREE.MeshStandardMaterial({ color: 0x385832, roughness: 0.95, side: THREE.DoubleSide, flatShading: true }),
  fernLight: new THREE.MeshStandardMaterial({ color: 0x45683d, roughness: 0.95, side: THREE.DoubleSide, flatShading: true }),
  rock: [
    new THREE.MeshStandardMaterial({ color: 0x6c7067, roughness: 1, flatShading: true }),
    new THREE.MeshStandardMaterial({ color: 0x5b615a, roughness: 1, flatShading: true }),
    new THREE.MeshStandardMaterial({ color: 0x7b7a6e, roughness: 1, flatShading: true }),
  ],
  hill: new THREE.MeshStandardMaterial({ color: 0x17251f, roughness: 1, flatShading: true }),
};

const windowHaloMaterial = new THREE.SpriteMaterial({
  map: glowTexture,
  color: 0xffa156,
  transparent: true,
  opacity: 0.33,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  toneMapped: false,
});

const lightPoolMaterial = new THREE.MeshBasicMaterial({
  map: glowTexture,
  color: 0xff9b4c,
  transparent: true,
  opacity: 0.2,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  toneMapped: false,
  side: THREE.DoubleSide,
});

/* -------------------------------------------------------------------------- */
/*  Shared geometry                                                          */
/* -------------------------------------------------------------------------- */

const GEO = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cylinder8: new THREE.CylinderGeometry(1, 1, 1, 8, 1, false),
  cylinder6: new THREE.CylinderGeometry(1, 1, 1, 6, 1, false),
  cylinder12: new THREE.CylinderGeometry(1, 1, 1, 12, 1, false),
  rock: new THREE.DodecahedronGeometry(1, 0),
  ico: new THREE.IcosahedronGeometry(1, 1),
  icoLow: new THREE.IcosahedronGeometry(1, 0),
  cone7: new THREE.ConeGeometry(1, 1, 7, 1),
  cone4: new THREE.ConeGeometry(1, 1, 4, 1),
  sphere: new THREE.SphereGeometry(1, 12, 8),
  leaf: null,
};

function addBox(parent, material, w, h, d, x = 0, y = 0, z = 0, cast = true, receive = true) {
  const mesh = new THREE.Mesh(GEO.box, material);
  mesh.scale.set(w, h, d);
  mesh.position.set(x, y, z);
  mesh.castShadow = cast;
  mesh.receiveShadow = receive;
  parent.add(mesh);
  return mesh;
}

function addCylinder(parent, material, radius, height, x = 0, y = 0, z = 0, segments = 8, cast = true, receive = true) {
  const geo = segments === 6 ? GEO.cylinder6 : segments === 12 ? GEO.cylinder12 : GEO.cylinder8;
  const mesh = new THREE.Mesh(geo, material);
  mesh.scale.set(radius, height, radius);
  mesh.position.set(x, y, z);
  mesh.castShadow = cast;
  mesh.receiveShadow = receive;
  parent.add(mesh);
  return mesh;
}

/* -------------------------------------------------------------------------- */
/*  Sky, stars, moon, distant hills                                          */
/* -------------------------------------------------------------------------- */

const MOON_POSITION = new THREE.Vector3(-50, 18, -48);
const moonDirection = MOON_POSITION.clone().normalize();

const skyUniforms = {
  uTopColor: { value: new THREE.Color(0x061020) },
  uHorizonColor: { value: new THREE.Color(0x9b6757) },
  uBottomColor: { value: new THREE.Color(0x08110f) },
  uGlowColor: { value: new THREE.Color(0xffbe83) },
  uGlowStrength: { value: 0.42 },
  uMoonDir: { value: moonDirection.clone() },
};

const sky = new THREE.Mesh(
  new THREE.SphereGeometry(100, 48, 28),
  new THREE.ShaderMaterial({
    uniforms: skyUniforms,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    toneMapped: false,
    vertexShader: [
      'varying vec3 vWorldPosition;',
      'void main() {',
      '  vec4 worldPosition = modelMatrix * vec4(position, 1.0);',
      '  vWorldPosition = worldPosition.xyz;',
      '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
      '}',
    ].join('\n'),
    fragmentShader: [
      'uniform vec3 uTopColor;',
      'uniform vec3 uHorizonColor;',
      'uniform vec3 uBottomColor;',
      'uniform vec3 uGlowColor;',
      'uniform float uGlowStrength;',
      'uniform vec3 uMoonDir;',
      'varying vec3 vWorldPosition;',
      'void main() {',
      '  vec3 dir = normalize(vWorldPosition);',
      '  float upper = smoothstep(-0.015, 0.58, dir.y);',
      '  vec3 color = mix(uHorizonColor, uTopColor, upper);',
      '  color = mix(uBottomColor, color, smoothstep(-0.28, 0.015, dir.y));',
      '  float glow = pow(max(dot(dir, uMoonDir), 0.0), 22.0);',
      '  color += uGlowColor * glow * uGlowStrength;',
      '  float dither = (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;',
      '  color += dither;',
      '  gl_FragColor = vec4(color, 1.0);',
      '  #include <tonemapping_fragment>',
      '  #include <colorspace_fragment>',
      '}',
    ].join('\n'),
  })
);
sky.renderOrder = -20;
scene.add(sky);

const moonPosition = MOON_POSITION.clone();
const moonMaterial = new THREE.MeshBasicMaterial({
  color: 0xf3eedb,
  fog: false,
  toneMapped: false,
});
const moon = new THREE.Mesh(new THREE.SphereGeometry(2.25, 24, 16), moonMaterial);
moon.position.copy(moonPosition);
moon.renderOrder = -10;
scene.add(moon);

const moonGlowMaterial = new THREE.SpriteMaterial({
  map: glowTexture,
  color: 0xffddaa,
  transparent: true,
  opacity: 0.32,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  depthTest: true,
  fog: false,
  toneMapped: false,
});
const moonGlow = new THREE.Sprite(moonGlowMaterial);
moonGlow.position.copy(moonPosition);
moonGlow.scale.set(18, 18, 1);
moonGlow.renderOrder = -9;
scene.add(moonGlow);

function makeStars(count, radiusMin, radiusMax, size, opacity) {
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const theta = rand() * TAU;
    const phi = Math.acos(randRange(0.02, 0.98));
    const radius = randRange(radiusMin, radiusMax);
    positions[i * 3] = Math.sin(phi) * Math.cos(theta) * radius;
    positions[i * 3 + 1] = Math.cos(phi) * radius;
    positions[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * radius;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    color: 0xd8e5ff,
    size,
    sizeAttenuation: true,
    transparent: true,
    opacity,
    depthWrite: false,
    fog: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const points = new THREE.Points(geometry, material);
  points.renderOrder = -12;
  scene.add(points);
  return material;
}

const starMaterials = [
  makeStars(750, 76, 88, 0.18, 0.82),
  makeStars(90, 74, 84, 0.36, 0.9),
];

// A ring of soft, foggy hills gives the clearing a sense of distance.
const hillGeometry = new THREE.SphereGeometry(1, 9, 5);
const hillRandom = mulberry32(8033);
for (let i = 0; i < 17; i++) {
  const angle = (i / 17) * TAU + hillRandom() * 0.18;
  const radius = 37 + hillRandom() * 17;
  const hill = new THREE.Mesh(hillGeometry, MAT.hill);
  hill.position.set(Math.cos(angle) * radius, -2.6 - hillRandom() * 1.4, Math.sin(angle) * radius);
  hill.scale.set(8 + hillRandom() * 12, 4.5 + hillRandom() * 5.5, 7 + hillRandom() * 11);
  hill.rotation.y = hillRandom() * TAU;
  hill.receiveShadow = false;
  hill.castShadow = false;
  scene.add(hill);
}

/* -------------------------------------------------------------------------- */
/*  Lights                                                                    */
/* -------------------------------------------------------------------------- */

const hemiLight = new THREE.HemisphereLight(0x6f8eb8, 0x1e2817, 0.75);
scene.add(hemiLight);

const keyLight = new THREE.DirectionalLight(0xb9d0ff, 2.25);
keyLight.position.set(13, 22, 16);
keyLight.target.position.set(0, 2.2, 0);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(2048, 2048);
keyLight.shadow.camera.left = -17;
keyLight.shadow.camera.right = 17;
keyLight.shadow.camera.top = 17;
keyLight.shadow.camera.bottom = -17;
keyLight.shadow.camera.near = 2;
keyLight.shadow.camera.far = 60;
keyLight.shadow.bias = -0.0004;
keyLight.shadow.normalBias = 0.045;
scene.add(keyLight);
scene.add(keyLight.target);

const rimLight = new THREE.DirectionalLight(0x45698e, 0.62);
rimLight.position.set(12, 8, -15);
scene.add(rimLight);

const WINDOW_LIGHTS = [];
const LANTERN_POINTS = [];
const LANTERN_PIVOTS = [];
const LIGHT_POOLS = [];
const HALO_MATERIALS = [];
let CONFIG_DOOR_LIGHT = null;

/* -------------------------------------------------------------------------- */
/*  Ground, path, clearing                                                    */
/* -------------------------------------------------------------------------- */

const groundGeometry = new THREE.PlaneGeometry(90, 90, 120, 120);
groundGeometry.rotateX(-Math.PI / 2);
{
  const positions = groundGeometry.attributes.position;
  const colors = new Float32Array(positions.count * 3);
  const grassDark = new THREE.Color(0x354329);
  const grassMid = new THREE.Color(0x59633a);
  const grassLight = new THREE.Color(0x6f7449);
  const dirt = new THREE.Color(0x67533d);
  const soil = new THREE.Color(0x3d3627);
  const moss = new THREE.Color(0x38452c);
  const shoreMud = new THREE.Color(0x6b573e);
  const pondBed = new THREE.Color(0x272d23);
  const color = new THREE.Color();

  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i);
    const z = positions.getZ(i);
    const y = terrainHeight(x, z);
    positions.setY(i, y);

    const broad = fbm(x * 0.18 + 12, z * 0.18 - 3, 3);
    const fine = fbm(x * 0.8, z * 0.8, 2);
    color.copy(grassDark).lerp(grassMid, smoothstep(0.3, 0.76, broad));
    color.lerp(grassLight, smoothstep(0.6, 0.9, fine) * 0.35);
    color.lerp(moss, smoothstep(0.58, 0.84, broad) * 0.25);

    const pathDistance = z > 2.5 && z < 16.2 ? Math.abs(x - pathCenterX(z)) : 99;
    const pathMask = (1 - smoothstep(0.55, 1.35, pathDistance)) * smoothstep(2.4, 3.4, z) * (1 - smoothstep(14.6, 16.2, z));
    color.lerp(dirt, pathMask * 0.9);

    const cabinMask = 1 - smoothstep(3.1, 5.4, Math.hypot(x, z * 0.92));
    color.lerp(soil, cabinMask * 0.45);

    const pondDistance = Math.hypot(x - POND.x, z - POND.z);
    const shoreMask = 1 - smoothstep(POND.r * 0.82, POND.r * 1.5, pondDistance);
    color.lerp(shoreMud, shoreMask * 0.58);
    const bedMask = 1 - smoothstep(POND.r * 0.45, POND.r * 0.98, pondDistance);
    color.lerp(pondBed, bedMask * 0.72);

    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }

  groundGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  groundGeometry.computeVertexNormals();
}

const groundMaterial = new THREE.MeshStandardMaterial({
  map: groundTexture,
  vertexColors: true,
  color: 0xffffff,
  roughness: 1,
  metalness: 0,
});
const ground = new THREE.Mesh(groundGeometry, groundMaterial);
ground.receiveShadow = true;
scene.add(ground);

// A worn, irregular path made of flat stones.
const pathRandom = mulberry32(1289);
const pathGroup = new THREE.Group();
scene.add(pathGroup);
for (let i = 0; i < 14; i++) {
  const z = 4.05 + i * 0.78 + pathRandom() * 0.22;
  const x = pathCenterX(z) + (pathRandom() - 0.5) * 0.34;
  const stone = new THREE.Mesh(GEO.rock, MAT.rock[i % 3]);
  const scale = 0.28 + pathRandom() * 0.17;
  stone.scale.set(scale * 1.35, scale * 0.16, scale * 0.92);
  stone.position.set(x, terrainHeight(x, z) + 0.045, z);
  stone.rotation.set(pathRandom() * 0.1, pathRandom() * TAU, pathRandom() * 0.08);
  stone.castShadow = true;
  stone.receiveShadow = true;
  pathGroup.add(stone);
}

// A small hand-painted trail sign, with a lantern.
const signRandom = mulberry32(551);
const signGroup = new THREE.Group();
{
  const sx = pathCenterX(7.6) + 2.15;
  const sz = 7.55;
  const sy = terrainHeight(sx, sz);
  signGroup.position.set(sx, sy, sz);
  signGroup.rotation.y = Math.atan2(12.5 - sx, 18.5 - sz);
  scene.add(signGroup);

  addCylinder(signGroup, MAT.darkBeam, 0.065, 2.35, 0, 1.17, 0, 6);

  const board = addBox(signGroup, MAT.beam, 0.98, 0.49, 0.075, 0.36, 1.57, 0.02);
  board.castShadow = true;
  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(0.92, 0.375),
    new THREE.MeshBasicMaterial({
      map: signTextTexture,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    })
  );
  face.position.set(0.36, 1.57, 0.064);
  signGroup.add(face);

  // tiny hanging lantern at the top of the signpost
  addBox(signGroup, MAT.iron, 0.05, 0.05, 0.42, 0.06, 2.15, 0.19);
  addCylinder(signGroup, MAT.iron, 0.012, 0.15, 0.06, 2.06, 0.39, 6, false, false);
  const glow = addBox(signGroup, MAT.glass, 0.15, 0.21, 0.15, 0.06, 1.91, 0.39, false, false);
  addBox(signGroup, MAT.iron, 0.21, 0.035, 0.21, 0.06, 2.02, 0.39);
  addBox(signGroup, MAT.iron, 0.2, 0.03, 0.2, 0.06, 1.8, 0.39);
  const cap = new THREE.Mesh(GEO.cone4, MAT.iron);
  cap.scale.set(0.14, 0.12, 0.14);
  cap.position.set(0.06, 2.09, 0.39);
  signGroup.add(cap);

  const halo = new THREE.Sprite(windowHaloMaterial.clone());
  halo.material.opacity = 0.22;
  halo.material.userData.baseOpacity = 0.22;
  HALO_MATERIALS.push(halo.material);
  halo.position.set(0.06, 1.91, 0.47);
  halo.scale.set(1.15, 1.15, 1);
  signGroup.add(halo);

  const light = new THREE.PointLight(0xffa45c, 3.2, 4.6, 2);
  light.position.set(0.06, 1.95, 0.45);
  light.userData.baseIntensity = 3.2;
  signGroup.add(light);
  LANTERN_POINTS.push(light);
  glow.castShadow = false;
}

// mushrooms / forest floor props are added after the cabin (see below)

/* -------------------------------------------------------------------------- */
/*  Cabin                                                                     */
/* -------------------------------------------------------------------------- */

const cabin = new THREE.Group();
cabin.name = 'cabin';
scene.add(cabin);

const CABIN = {
  halfW: 3.1,
  halfD: 2.5,
  wallBottom: 0.84,
  wallTop: 4.16,
  ridgeY: 6.58,
  eaveY: 4.14,
  run: 3.32,
};
function subtractInterval(intervals, cutStart, cutEnd) {
  const result = [];
  for (const [start, end] of intervals) {
    if (cutEnd <= start || cutStart >= end) {
      result.push([start, end]);
    } else {
      if (cutStart > start) result.push([start, cutStart]);
      if (cutEnd < end) result.push([cutEnd, end]);
    }
  }
  return result.filter(([a, b]) => b - a > 0.075);
}

function buildLogWall(axis, fixed, start, end, holes, lengthOffset = 0.12) {
  const levels = 11;
  const spacing = 0.304;
  for (let level = 0; level < levels; level++) {
    const y = CABIN.wallBottom + 0.07 + level * spacing;
    let intervals = [[start, end]];
    for (const hole of holes) {
      if (y > hole.y0 - 0.13 && y < hole.y1 + 0.13) {
        intervals = subtractInterval(intervals, hole.a, hole.b);
      }
    }
    intervals.forEach(([a, b], segmentIndex) => {
      const length = b - a + lengthOffset;
      const mid = (a + b) / 2;
      const material = [
        MAT.logSides[(level + segmentIndex) % 3],
        MAT.logEnd,
        MAT.logEnd,
      ];
      const log = new THREE.Mesh(GEO.cylinder8, material);
      log.scale.set(0.155, length, 0.155);
      if (axis === 'x') {
        log.rotation.z = Math.PI / 2;
        log.position.set(mid, y, fixed);
      } else {
        log.rotation.x = Math.PI / 2;
        log.position.set(fixed, y, mid);
      }
      log.castShadow = true;
      log.receiveShadow = true;
      cabin.add(log);
    });
  }
}

// Stone plinth
addBox(cabin, MAT.stone, 6.48, 0.74, 5.28, 0, 0.36, 0);
addBox(cabin, MAT.stoneDark, 6.6, 0.12, 5.4, 0, 0.06, 0);

{
  const foundationStones = mulberry32(332);
  for (let i = 0; i < 46; i++) {
    const front = foundationStones() > 0.5 ? 1 : -1;
    const side = foundationStones() > 0.5;
    let x;
    let z;
    if (side) {
      x = (foundationStones() > 0.5 ? 1 : -1) * 3.2;
      z = (foundationStones() - 0.5) * 5.0;
    } else {
      x = (foundationStones() - 0.5) * 6.2;
      z = front * 2.56;
    }
    const stone = new THREE.Mesh(GEO.rock, MAT.rock[i % 3]);
    const s = 0.16 + foundationStones() * 0.2;
    stone.scale.set(s * 1.4, s * 0.85, s);
    stone.position.set(x, 0.2 + foundationStones() * 0.38, z);
    stone.rotation.set(foundationStones() * 0.4, foundationStones() * TAU, foundationStones() * 0.3);
    stone.castShadow = true;
    stone.receiveShadow = true;
    cabin.add(stone);
  }
}

const frontHoles = [
  { a: 0.0, b: 1.16, y0: 0.72, y1: 3.1 },
  { a: -2.3, b: -1.16, y0: 2.16, y1: 3.4 },
];
const backHoles = [
  { a: -1.96, b: -1.04, y0: 2.18, y1: 3.28 },
];
const rightHoles = [
  { a: 0.02, b: 1.1, y0: 2.16, y1: 3.4 },
];
const leftHoles = [
  { a: -1.5, b: -0.5, y0: 2.2, y1: 3.32 },
];

buildLogWall('x', CABIN.halfD, -CABIN.halfW, CABIN.halfW, frontHoles);
buildLogWall('x', -CABIN.halfD, -CABIN.halfW, CABIN.halfW, backHoles);
buildLogWall('z', CABIN.halfW, -CABIN.halfD, CABIN.halfD, rightHoles);
buildLogWall('z', -CABIN.halfW, -CABIN.halfD, CABIN.halfD, leftHoles);

// wall-top beams
addBox(cabin, MAT.beam, 6.6, 0.24, 0.22, 0, CABIN.wallTop, CABIN.halfD + 0.01);
addBox(cabin, MAT.beam, 6.6, 0.24, 0.22, 0, CABIN.wallTop, -CABIN.halfD - 0.01);
addBox(cabin, MAT.beam, 0.22, 0.24, 5.35, CABIN.halfW + 0.01, CABIN.wallTop, 0);
addBox(cabin, MAT.beam, 0.22, 0.24, 5.35, -CABIN.halfW - 0.01, CABIN.wallTop, 0);

// Gable ends: the ridge runs along X, so the triangular walls belong on the
// left and right sides of the cabin. The old front/back triangles pierced the
// roof and have been replaced with proper side gables plus an eave frieze.
{
  const gableRandom = mulberry32(983);
  const apexRise = CABIN.ridgeY - CABIN.wallTop;
  const plankWidth = 0.235;
  for (const side of [-1, 1]) {
    const x = side * (CABIN.halfW + 0.07);
    for (let i = -10; i <= 10; i++) {
      const z = i * 0.236;
      const top = CABIN.wallTop + (1 - Math.abs(z) / CABIN.halfD) * apexRise;
      const height = top - CABIN.wallTop;
      if (height < 0.11) continue;
      const material = MAT.plank.clone();
      material.color.offsetHSL(0, 0, (gableRandom() - 0.5) * 0.1);
      addBox(cabin, material, 0.17, height, plankWidth, x, CABIN.wallTop + height / 2, z);
    }
  }

  // Close the horizontal gap above the front/back eave walls up to the roof underside.
  const roofAtWall = CABIN.ridgeY - (CABIN.halfD / CABIN.run) * (CABIN.ridgeY - CABIN.eaveY);
  const friezeTop = roofAtWall - 0.19;
  const friezeHeight = friezeTop - CABIN.wallTop;
  for (const z of [CABIN.halfD - 0.015, -CABIN.halfD + 0.015]) {
    for (let i = -13; i <= 13; i++) {
      const material = MAT.plank.clone();
      material.color.offsetHSL(0, 0, (gableRandom() - 0.5) * 0.09);
      addBox(cabin, material, 0.235, friezeHeight, 0.17, i * 0.236, CABIN.wallTop + friezeHeight / 2, z);
    }
    addBox(cabin, MAT.darkBeam, 6.55, 0.09, 0.18, 0, friezeTop, z);
  }

  // Bargeboards along the sloping roof edges at the two gable ends.
  const slopeLength = Math.hypot(CABIN.run, apexRise);
  const slopeAngle = Math.atan2(apexRise, CABIN.run);
  for (const side of [-1, 1]) {
    for (const dir of [-1, 1]) {
      const board = addBox(cabin, MAT.darkBeam, 0.14, 0.16, slopeLength + 0.2, side * 3.83, (CABIN.eaveY + CABIN.ridgeY) / 2 + 0.03, dir * (CABIN.run / 2));
      board.rotation.x = dir * slopeAngle;
    }
  }
}

// Round attic windows, now in the correct gable ends.
for (const side of [-1, 1]) {
  const group = new THREE.Group();
  group.position.set(side * (CABIN.halfW + 0.17), 5.02, 0);
  group.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2;
  cabin.add(group);

  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.046, 7, 22), MAT.trim);
  group.add(ring);
  const glass = new THREE.Mesh(new THREE.CircleGeometry(0.305, 24), MAT.glass);
  glass.position.z = -0.012;
  group.add(glass);
  addBox(group, MAT.trim, 0.035, 0.61, 0.04, 0, 0, 0.019);
  addBox(group, MAT.trim, 0.61, 0.035, 0.04, 0, 0, 0.019);

  const halo = new THREE.Sprite(windowHaloMaterial.clone());
  halo.material.opacity = 0.2;
  halo.material.userData.baseOpacity = 0.2;
  HALO_MATERIALS.push(halo.material);
  halo.scale.set(1.8, 1.8, 1);
  halo.position.z = 0.27;
  group.add(halo);
}

// Roof
{
  const slopeLength = Math.hypot(CABIN.run, CABIN.ridgeY - CABIN.eaveY);
  const angle = Math.atan2(CABIN.ridgeY - CABIN.eaveY, CABIN.run);
  const roofGeo = new THREE.BoxGeometry(7.72, 0.18, slopeLength + 0.18);
  const roofMaterials = [MAT.roofSide, MAT.roofSide, MAT.roofTop, MAT.roofUnder, MAT.roofSide, MAT.roofSide];

  for (const dir of [1, -1]) {
    const roof = new THREE.Mesh(roofGeo, roofMaterials);
    roof.position.set(0, (CABIN.eaveY + CABIN.ridgeY) / 2 + 0.04, dir * (CABIN.run / 2));
    roof.rotation.x = dir * angle;
    roof.castShadow = true;
    roof.receiveShadow = true;
    cabin.add(roof);
  }

  addBox(cabin, MAT.darkBeam, 7.85, 0.2, 0.34, 0, CABIN.ridgeY + 0.12, 0);
  addBox(cabin, MAT.darkBeam, 7.86, 0.17, 0.18, 0, CABIN.eaveY - 0.015, CABIN.run + 0.06);
  addBox(cabin, MAT.darkBeam, 7.86, 0.17, 0.18, 0, CABIN.eaveY - 0.015, -CABIN.run - 0.06);

  // Rafter tails under the eaves
  for (let i = -3; i <= 3; i++) {
    for (const dir of [1, -1]) {
      const rafter = addBox(cabin, MAT.darkBeam, 0.11, 0.13, 0.56, i * 1.02, CABIN.eaveY - 0.15, dir * (CABIN.halfD + 0.45));
      rafter.rotation.x = dir * angle * 0.52;
    }
  }

  // mossy patches on the shingles
  const roofRand = mulberry32(2291);
  for (let i = 0; i < 22; i++) {
    const dir = roofRand() > 0.5 ? 1 : -1;
    const z = dir * (0.45 + roofRand() * (CABIN.run - 0.7));
    const x = (roofRand() - 0.5) * 6.9;
    const y = CABIN.ridgeY - (Math.abs(z) / CABIN.run) * (CABIN.ridgeY - CABIN.eaveY) + 0.075;
    const patch = new THREE.Mesh(GEO.icoLow, roofRand() > 0.7 ? MAT.mossLight : MAT.moss);
    const s = 0.12 + roofRand() * 0.28;
    patch.scale.set(s * 1.7, s * 0.22, s);
    patch.position.set(x, y, z);
    patch.rotation.y = roofRand() * TAU;
    patch.receiveShadow = true;
    cabin.add(patch);
  }
}

// Chimney
const CHIMNEY_TOP = new THREE.Vector3(-2.02, 7.32, -0.82);
{
  addBox(cabin, MAT.stone, 0.84, 3.15, 0.76, CHIMNEY_TOP.x, 5.35, CHIMNEY_TOP.z, true, true);
  const chimneyRand = mulberry32(771);
  for (let layer = 0; layer < 16; layer++) {
    const y = 3.93 + layer * 0.195;
    for (let i = 0; i < 3; i++) {
      const block = new THREE.Mesh(GEO.box, MAT.rock[Math.floor(chimneyRand() * 3)]);
      block.material = chimneyRand() > 0.5 ? MAT.stone : MAT.stoneDark;
      const bw = 0.16 + chimneyRand() * 0.2;
      const bh = 0.13 + chimneyRand() * 0.1;
      const bd = 0.08 + chimneyRand() * 0.12;
      const side = i === 0 ? -1 : i === 1 ? 1 : 0;
      block.scale.set(bw, bh, bd);
      if (side === 0) {
        block.position.set(CHIMNEY_TOP.x + (chimneyRand() - 0.5) * 0.45, y, CHIMNEY_TOP.z + 0.4);
        block.rotation.y = (chimneyRand() - 0.5) * 0.18;
      } else {
        block.position.set(CHIMNEY_TOP.x + side * 0.39, y, CHIMNEY_TOP.z + (chimneyRand() - 0.5) * 0.5);
        block.rotation.y = (chimneyRand() - 0.5) * 0.18;
      }
      block.castShadow = true;
      block.receiveShadow = true;
      cabin.add(block);
    }
  }
  addBox(cabin, MAT.stoneLight, 1.02, 0.12, 0.94, CHIMNEY_TOP.x, 7.02, CHIMNEY_TOP.z);
  addBox(cabin, MAT.stoneDark, 0.9, 0.1, 0.82, CHIMNEY_TOP.x, 7.13, CHIMNEY_TOP.z);
  addBox(cabin, MAT.roofUnder, 0.38, 0.08, 0.32, CHIMNEY_TOP.x, 7.2, CHIMNEY_TOP.z);
}

// Door recess and warm glow
{
  const doorX = 0.58;
  addBox(cabin, new THREE.MeshStandardMaterial({ color: 0x1c1410, roughness: 1 }), 1.3, 2.42, 0.12, doorX, 1.89, 2.38);

  const glow = new THREE.Mesh(new THREE.PlaneGeometry(1.16, 2.25), MAT.doorGlow);
  glow.position.set(doorX, 1.88, 2.397);
  cabin.add(glow);

  const doorMat = MAT.doorPlank;
  for (let i = 0; i < 5; i++) {
    const board = addBox(cabin, doorMat, 0.2, 2.14, 0.055, doorX + (i - 2) * 0.207, 1.87, 2.44);
    board.material = doorMat.clone();
    board.material.color.offsetHSL(0, 0, (i - 2) * 0.012);
  }

  addBox(cabin, MAT.darkBeam, 1.01, 0.085, 0.045, doorX, 1.28, 2.475);
  addBox(cabin, MAT.darkBeam, 1.01, 0.08, 0.045, doorX, 2.25, 2.475);

  // little window in the door
  addBox(cabin, MAT.glass, 0.44, 0.34, 0.025, doorX, 2.57, 2.476, false, false);
  addBox(cabin, MAT.trim, 0.05, 0.52, 0.055, doorX, 2.57, 2.49);
  addBox(cabin, MAT.trim, 0.52, 0.05, 0.055, doorX, 2.57, 2.49);

  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.057, 0.012, 6, 13), MAT.brass);
  handle.position.set(doorX + 0.43, 1.7, 2.505);
  cabin.add(handle);
  addCylinder(cabin, MAT.iron, 0.015, 0.055, doorX + 0.43, 1.7, 2.49, 6, false, false).rotation.x = Math.PI / 2;

  // hinges
  for (const y of [1.23, 2.24]) {
    addBox(cabin, MAT.iron, 0.1, 0.055, 0.024, doorX - 0.48, y, 2.48);
  }

  // thick frame
  addBox(cabin, MAT.trim, 0.13, 2.42, 0.17, doorX - 0.63, 1.9, 2.55);
  addBox(cabin, MAT.trim, 0.13, 2.42, 0.17, doorX + 0.63, 1.9, 2.55);
  addBox(cabin, MAT.trim, 1.38, 0.16, 0.17, doorX, 3.11, 2.55);
  addBox(cabin, MAT.stoneLight, 1.38, 0.11, 0.46, doorX, 0.79, 2.68);

  const doorLight = new THREE.PointLight(0xff9b52, 3.1, 5.5, 2);
  doorLight.position.set(doorX, 2.25, 3.12);
  doorLight.userData.baseIntensity = 3.1;
  scene.add(doorLight);
  CONFIG_DOOR_LIGHT = doorLight;
}

// Windows
function createWindow(x, y, z, rotationY, width, height, shutters = true, withLight = true) {
  const group = new THREE.Group();
  group.position.set(x, y, z);
  group.rotation.y = rotationY;
  cabin.add(group);

  addBox(group, MAT.glass, width - 0.12, height - 0.1, 0.032, 0, 0, -0.055, false, false);

  const frame = MAT.trim;
  addBox(group, frame, width + 0.16, 0.105, 0.11, 0, height / 2 + 0.015, 0.035);
  addBox(group, frame, width + 0.16, 0.105, 0.11, 0, -height / 2 - 0.015, 0.035);
  addBox(group, frame, 0.105, height + 0.16, 0.11, -width / 2, 0, 0.035);
  addBox(group, frame, 0.105, height + 0.16, 0.11, width / 2, 0, 0.035);
  addBox(group, frame, 0.045, height - 0.08, 0.075, 0, 0, 0.065);
  addBox(group, frame, width - 0.08, 0.045, 0.075, 0, 0, 0.065);
  addBox(group, MAT.trim, width + 0.34, 0.08, 0.25, 0, -height / 2 - 0.1, 0.15);

  if (shutters) {
    for (const side of [-1, 1]) {
      const sx = side * (width / 2 + 0.22);
      addBox(group, MAT.shutter, 0.33, height * 0.94, 0.055, sx, 0, 0.02);
      for (let i = 0; i < 5; i++) {
        addBox(group, MAT.darkBeam, 0.27, 0.022, 0.022, sx, -height * 0.36 + i * height * 0.18, 0.055);
      }
    }
  }

  const halo = new THREE.Sprite(windowHaloMaterial.clone());
  halo.material.userData.baseOpacity = halo.material.opacity;
  HALO_MATERIALS.push(halo.material);
  halo.position.set(0, 0.02, 0.2);
  halo.scale.set(width * 2.05, height * 1.75, 1);
  group.add(halo);

  if (withLight) {
    const nx = Math.sin(rotationY);
    const nz = Math.cos(rotationY);
    const light = new THREE.PointLight(0xffa158, 7.5, 7.2, 2);
    light.position.set(x + nx * 0.55, y + 0.05, z + nz * 0.55);
    light.userData.baseIntensity = 7.5;
    scene.add(light);
    WINDOW_LIGHTS.push(light);
  }
  return group;
}

createWindow(-1.73, 2.8, CABIN.halfD + 0.05, 0, 1.1, 1.18, true, true);
createWindow(CABIN.halfW + 0.05, 2.82, 0.56, Math.PI / 2, 1.04, 1.16, true, true);
createWindow(-CABIN.halfW - 0.05, 2.86, -1.0, -Math.PI / 2, 0.96, 1.12, false, true);
createWindow(-1.5, 2.76, -CABIN.halfD - 0.05, Math.PI, 0.9, 1.04, true, true);

// Porch deck
{
  const deckZ = 3.32;
  const deckWidth = 4.55;
  addBox(cabin, MAT.darkBeam, 4.65, 0.16, 0.16, 0, 0.65, 2.6);
  addBox(cabin, MAT.darkBeam, 4.65, 0.16, 0.16, 0, 0.65, 4.02);
  addBox(cabin, MAT.darkBeam, 0.14, 0.18, 1.48, -2.22, 0.64, deckZ);
  addBox(cabin, MAT.darkBeam, 0.14, 0.18, 1.48, 2.22, 0.64, deckZ);

  for (let i = 0; i < 11; i++) {
    const z = 2.6 + i * 0.14;
    const board = addBox(cabin, MAT.deck, deckWidth, 0.075, 0.127, 0, 0.765, z, true, true);
    board.material = MAT.deck.clone();
    board.material.color.offsetHSL(0, 0, (i % 3 - 1) * 0.012);
  }

  // steps
  addBox(cabin, MAT.deck, 1.92, 0.14, 0.34, 0.58, 0.57, 4.22);
  addBox(cabin, MAT.deck, 1.92, 0.14, 0.34, 0.58, 0.34, 4.52);
  addBox(cabin, MAT.stoneLight, 1.45, 0.11, 0.5, 0.58, 0.08, 4.7);

  // simple railing
  for (const side of [-1, 1]) {
    const x = side * 2.24;
    addBox(cabin, MAT.darkBeam, 0.065, 0.98, 0.065, x, 1.24, 3.94);
    addBox(cabin, MAT.darkBeam, 0.065, 0.36, 0.065, x, 1.06, 2.68);
    addBox(cabin, MAT.darkBeam, 0.06, 0.06, 1.31, x, 1.63, 3.3);
    for (let i = 0; i < 3; i++) {
      addBox(cabin, MAT.darkBeam, 0.035, 0.57, 0.035, x, 1.32, 2.9 + i * 0.36);
    }
  }

  // bench under the front window
  addBox(cabin, MAT.darkBeam, 1.17, 0.075, 0.42, -1.55, 1.05, 2.95);
  addBox(cabin, MAT.darkBeam, 1.17, 0.48, 0.06, -1.55, 1.31, 3.12);
  addBox(cabin, MAT.fabric, 1.07, 0.065, 0.33, -1.55, 1.102, 2.93);
  for (const x of [-2.02, -1.08]) {
    for (const z of [2.82, 3.06]) {
      addBox(cabin, MAT.darkBeam, 0.06, 0.34, 0.06, x, 0.9, z);
    }
  }
  addBox(cabin, MAT.darkBeam, 1.12, 0.06, 1.3, -0.75, 0.69, 2.95);

  // doormat
  addBox(cabin, MAT.fabric, 0.84, 0.018, 0.47, 0.58, 0.812, 2.83, false, true);

  const pool = new THREE.Mesh(new THREE.PlaneGeometry(4.3, 3.2), lightPoolMaterial);
  pool.rotation.x = -Math.PI / 2;
  pool.position.set(0.55, 0.815, 3.32);
  pool.renderOrder = 2;
  pool.userData.baseOpacity = 0.2;
  cabin.add(pool);
  LIGHT_POOLS.push(pool);

  const stepPool = new THREE.Mesh(new THREE.PlaneGeometry(3.1, 2.1), lightPoolMaterial.clone());
  stepPool.material.opacity = 0.12;
  stepPool.rotation.x = -Math.PI / 2;
  stepPool.position.set(0.58, 0.045, 4.8);
  stepPool.renderOrder = 2;
  stepPool.userData.baseOpacity = 0.12;
  cabin.add(stepPool);
  LIGHT_POOLS.push(stepPool);
}

// Hanging lantern beside the door
{
  const pivot = new THREE.Group();
  pivot.position.set(1.5, 2.9, 2.97);
  cabin.add(pivot);
  LANTERN_PIVOTS.push(pivot);

  addBox(pivot, MAT.iron, 0.045, 0.045, 0.48, 0, 0, -0.19);
  addCylinder(pivot, MAT.iron, 0.012, 0.22, 0, -0.12, 0, 6, false, false);

  const body = new THREE.Group();
  body.position.set(0, -0.38, 0);
  pivot.add(body);

  addBox(body, MAT.glass, 0.17, 0.25, 0.17, 0, 0, 0, false, false);
  for (const x of [-0.105, 0.105]) {
    for (const z of [-0.105, 0.105]) {
      addBox(body, MAT.iron, 0.022, 0.31, 0.022, x, 0.01, z, false, false);
    }
  }
  addBox(body, MAT.iron, 0.235, 0.035, 0.235, 0, 0.17, 0, false, false);
  addBox(body, MAT.iron, 0.235, 0.035, 0.235, 0, -0.17, 0, false, false);
  const top = new THREE.Mesh(GEO.cone4, MAT.iron);
  top.scale.set(0.19, 0.14, 0.19);
  top.position.y = 0.24;
  body.add(top);
  addCylinder(body, MAT.iron, 0.009, 0.1, 0, 0.33, 0, 6, false, false);

  const halo = new THREE.Sprite(windowHaloMaterial.clone());
  halo.material.opacity = 0.33;
  halo.material.userData.baseOpacity = 0.33;
  HALO_MATERIALS.push(halo.material);
  halo.scale.set(1.65, 1.65, 1);
  body.add(halo);

  const light = new THREE.PointLight(0xffa258, 4.4, 5.2, 2);
  light.position.set(0, 0, 0);
  light.userData.baseIntensity = 4.4;
  body.add(light);
  LANTERN_POINTS.push(light);
}

// Woodpile and axe
{
  const pileRand = mulberry32(995);
  for (let row = 0; row < 3; row++) {
    const count = 5 - row;
    for (let i = 0; i < count; i++) {
      const x = 3.48 + row * 0.12 + i * 0.235;
      const y = 0.18 + row * 0.215;
      const z = -1.55 + (pileRand() - 0.5) * 0.06;
      const log = new THREE.Mesh(GEO.cylinder8, [MAT.logSides[i % 3], MAT.logEnd, MAT.logEnd]);
      log.scale.set(0.105, 0.82 + pileRand() * 0.12, 0.105);
      log.rotation.x = Math.PI / 2;
      log.position.set(x, y, z);
      log.castShadow = true;
      log.receiveShadow = true;
      cabin.add(log);
    }
  }

  const stumpX = 4.18;
  const stumpZ = 0.12;
  const stumpY = terrainHeight(stumpX, stumpZ);
  addCylinder(cabin, MAT.bark, 0.3, 0.46, stumpX, stumpY + 0.23, stumpZ, 8);
  addCylinder(cabin, MAT.logEnd, 0.285, 0.035, stumpX, stumpY + 0.47, stumpZ, 12);

  const axeHandle = addCylinder(cabin, MAT.beam, 0.023, 0.91, stumpX + 0.1, stumpY + 0.49, stumpZ + 0.02, 6);
  axeHandle.rotation.z = -0.48;
  const axeHead = addBox(cabin, MAT.iron, 0.23, 0.075, 0.3, stumpX + 0.36, stumpY + 0.84, stumpZ + 0.02);
  axeHead.rotation.z = -0.48;
}

// stone seat and wood rounds near the path
{
  const propRand = mulberry32(661);
  for (let i = 0; i < 4; i++) {
    const x = 4.55 + propRand() * 0.8;
    const z = 2.25 + propRand() * 1.4;
    const y = terrainHeight(x, z);
    const round = addCylinder(cabin, MAT.bark, 0.16 + propRand() * 0.08, 0.25, x, y + 0.13, z, 8);
    round.rotation.z = (propRand() - 0.5) * 0.25;
    addCylinder(cabin, MAT.logEnd, 0.15, 0.025, x, y + 0.27, z, 10);
  }
}

/* -------------------------------------------------------------------------- */
/*  Vegetation and small things                                               */
/* -------------------------------------------------------------------------- */

const swayTrees = [];

function createPine(x, z, scale, variantSeed) {
  const treeRandom = mulberry32(variantSeed);
  const y = terrainHeight(x, z);
  const tree = new THREE.Group();
  tree.position.set(x, y, z);
  tree.rotation.y = treeRandom() * TAU;
  scene.add(tree);

  const trunk = addCylinder(tree, MAT.bark, 0.17 * scale, 2.15 * scale, 0, 1.08 * scale, 0, 7);
  trunk.rotation.z = (treeRandom() - 0.5) * 0.04;

  const canopy = new THREE.Group();
  tree.add(canopy);
  const layers = 4;
  for (let i = 0; i < layers; i++) {
    const t = i / (layers - 1);
    const radius = (1.5 - i * 0.3) * scale;
    const height = (1.95 - i * 0.13) * scale;
    const cone = new THREE.Mesh(GEO.cone7, MAT.foliage[(i + variantSeed) % MAT.foliage.length]);
    cone.scale.set(radius, height, radius);
    cone.position.set((treeRandom() - 0.5) * 0.12 * scale, (1.62 + i * 0.78) * scale, (treeRandom() - 0.5) * 0.12 * scale);
    cone.rotation.y = treeRandom() * TAU;
    cone.castShadow = true;
    cone.receiveShadow = true;
    canopy.add(cone);
  }
  const tip = new THREE.Mesh(GEO.cone7, MAT.foliage[1]);
  tip.scale.set(0.45 * scale, 1.15 * scale, 0.45 * scale);
  tip.position.y = 4.9 * scale;
  tip.castShadow = true;
  canopy.add(tip);

  canopy.userData.baseRotation = 0;
  canopy.userData.phase = treeRandom() * TAU;
  swayTrees.push(canopy);
  return tree;
}

// nearby framing pines
createPine(-5.45, 3.25, 0.95, 11);
createPine(7.85, 6.25, 0.82, 29);
createPine(8.7, 1.05, 0.98, 47);
createPine(-7.1, -4.7, 1.35, 73);
createPine(7.8, -5.8, 1.12, 89);

{
  const forestRandom = mulberry32(4307);
  let placed = 0;
  let attempts = 0;
  while (placed < 44 && attempts < 300) {
    attempts++;
    const angle = forestRandom() * TAU;
    const radius = 9.5 + forestRandom() * 20;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    if (z > 3.3 && Math.abs(x) < 5.3) continue;
    if (Math.hypot(x - 7.85, z - 6.25) < 2.2) continue;
    if (Math.hypot(x - POND.x, z - POND.z) < POND.r + 2.1) continue;
    createPine(x, z, 0.62 + forestRandom() * 0.76, 100 + placed * 3);
    placed++;
  }
}

// Golden deciduous tree at the edge of the clearing
{
  const treeRandom = mulberry32(901);
  const x = -6.2;
  const z = -2.6;
  const tree = new THREE.Group();
  tree.position.set(x, terrainHeight(x, z), z);
  scene.add(tree);
  addCylinder(tree, MAT.birch, 0.16, 3.6, 0, 1.8, 0, 7).rotation.z = 0.035;
  const canopy = new THREE.Group();
  tree.add(canopy);
  for (let i = 0; i < 11; i++) {
    const blob = new THREE.Mesh(GEO.ico, MAT.gold[i % MAT.gold.length]);
    const angle = treeRandom() * TAU;
    const radius = treeRandom() * 1.45;
    const s = 0.55 + treeRandom() * 0.62;
    blob.scale.set(s, s * 0.8, s);
    blob.position.set(Math.cos(angle) * radius, 3.35 + treeRandom() * 1.4, Math.sin(angle) * radius);
    blob.rotation.set(treeRandom(), treeRandom(), treeRandom());
    blob.castShadow = true;
    blob.receiveShadow = true;
    canopy.add(blob);
  }
  canopy.userData.phase = treeRandom() * TAU;
  swayTrees.push(canopy);
}

function createBush(x, z, scale) {
  const bushRandom = mulberry32(Math.floor(x * 100 + z * 47 + scale * 31) + 900);
  const group = new THREE.Group();
  group.position.set(x, terrainHeight(x, z), z);
  scene.add(group);
  for (let i = 0; i < 4; i++) {
    const blob = new THREE.Mesh(GEO.ico, MAT.foliage[(i + 1) % 4]);
    const s = scale * (0.32 + bushRandom() * 0.35);
    blob.scale.set(s, s * 0.75, s);
    blob.position.set((bushRandom() - 0.5) * scale * 0.8, s * 0.8, (bushRandom() - 0.5) * scale * 0.8);
    blob.rotation.y = bushRandom() * TAU;
    blob.castShadow = true;
    blob.receiveShadow = true;
    group.add(blob);
  }
}

createBush(-3.55, 3.25, 0.95);
createBush(3.45, 2.45, 0.7);
createBush(-4.25, -2.95, 1.1);
createBush(4.7, -2.9, 0.85);
createBush(-2.9, 5.15, 0.62);

// Grass blades, instanced for a few thousand triangles at almost no cost.
{
  const bladeGeometry = new THREE.BufferGeometry();
  const positions = [];
  const normals = [];
  const bladeRandom = mulberry32(6111);
  for (let blade = 0; blade < 6; blade++) {
    const angle = bladeRandom() * TAU;
    const width = 0.025 + bladeRandom() * 0.025;
    const height = 0.22 + bladeRandom() * 0.3;
    const lean = (bladeRandom() - 0.5) * 0.18;
    const dx = Math.cos(angle);
    const dz = Math.sin(angle);
    const px = -dz * width;
    const pz = dx * width;
    positions.push(
      px, 0, pz,
      -px, 0, -pz,
      dx * lean, height, dz * lean
    );
    for (let k = 0; k < 3; k++) normals.push(0, 1, 0);
  }
  bladeGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  bladeGeometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));

  const count = 760;
  const grass = new THREE.InstancedMesh(bladeGeometry, MAT.grass, count);
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  const grassRandom = mulberry32(8181);
  let i = 0;
  let attempts = 0;
  while (i < count && attempts < count * 8) {
    attempts++;
    const angle = grassRandom() * TAU;
    const radius = 3.7 + Math.pow(grassRandom(), 0.72) * 20.5;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    if (z > 3 && Math.abs(x - pathCenterX(z)) < 1.05) continue;
    if (Math.hypot(x, z * 0.85) < 3.35) continue;
    if (Math.hypot(x - POND.x, z - POND.z) < POND.r + 0.55) continue;
    dummy.position.set(x, terrainHeight(x, z) + 0.01, z);
    dummy.rotation.set(0, grassRandom() * TAU, (grassRandom() - 0.5) * 0.12);
    const s = 0.7 + grassRandom() * 0.85;
    dummy.scale.set(s, s * (0.8 + grassRandom() * 0.7), s);
    dummy.updateMatrix();
    grass.setMatrixAt(i, dummy.matrix);
    color.setHSL(0.18 + grassRandom() * 0.07, 0.32 + grassRandom() * 0.22, 0.2 + grassRandom() * 0.16);
    grass.setColorAt(i, color);
    i++;
  }
  grass.count = i;
  grass.instanceMatrix.needsUpdate = true;
  if (grass.instanceColor) grass.instanceColor.needsUpdate = true;
  grass.receiveShadow = true;
  grass.castShadow = false;
  scene.add(grass);
}

// Ferns
{
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.bezierCurveTo(0.13, 0.16, 0.12, 0.55, 0, 0.94);
  shape.bezierCurveTo(-0.12, 0.55, -0.13, 0.16, 0, 0);
  const leafGeometry = new THREE.ShapeGeometry(shape, 7);
  const fernRandom = mulberry32(3771);
  const positions = [
    [-4.6, 3.9], [4.45, 2.9], [-4.2, -3.38], [3.9, 3.85],
    [-5.35, 1.1], [5.15, -0.9], [-2.9, -4.3], [2.8, -4.1],
    [-6.8, 4.2], [6.2, 4.1], [-5.9, -5.3], [5.6, -4.7],
    [-8.0, 0.9], [8.1, -1.8],
  ];
  for (let f = 0; f < positions.length; f++) {
    const [x, z] = positions[f];
    const group = new THREE.Group();
    group.position.set(x, terrainHeight(x, z) + 0.02, z);
    group.rotation.y = fernRandom() * TAU;
    scene.add(group);
    for (let i = 0; i < 7; i++) {
      const leaf = new THREE.Mesh(leafGeometry, i % 2 ? MAT.fern : MAT.fernLight);
      leaf.rotation.y = (i / 7) * TAU + fernRandom() * 0.4;
      leaf.rotation.x = -Math.PI / 2 + 0.28 + fernRandom() * 0.3;
      leaf.scale.setScalar(0.48 + fernRandom() * 0.36);
      leaf.castShadow = false;
      group.add(leaf);
    }
  }
}

// Mushrooms
{
  const mushroomRandom = mulberry32(5411);
  const clusters = [[4.28, 0.66], [-3.55, 3.05], [3.35, 2.2], [-4.0, -3.1]];
  for (const [cx, cz] of clusters) {
    for (let i = 0; i < 3; i++) {
      const x = cx + (mushroomRandom() - 0.5) * 0.55;
      const z = cz + (mushroomRandom() - 0.5) * 0.55;
      const y = terrainHeight(x, z);
      const stemHeight = 0.1 + mushroomRandom() * 0.08;
      addCylinder(scene, MAT.mushroomStem, 0.025, stemHeight, x, y + stemHeight / 2, z, 6, false, false);
      const cap = new THREE.Mesh(GEO.sphere, MAT.mushroomCap);
      cap.scale.set(0.1 + mushroomRandom() * 0.045, 0.055 + mushroomRandom() * 0.025, 0.1 + mushroomRandom() * 0.045);
      cap.position.set(x, y + stemHeight, z);
      cap.castShadow = true;
      scene.add(cap);
      for (let s = 0; s < 3; s++) {
        const spot = new THREE.Mesh(GEO.icoLow, MAT.mushroomSpot);
        const sr = 0.012 + mushroomRandom() * 0.009;
        spot.scale.setScalar(sr);
        spot.position.set(x + (mushroomRandom() - 0.5) * 0.12, y + stemHeight + 0.045, z + (mushroomRandom() - 0.5) * 0.12);
        scene.add(spot);
      }
    }
  }
}

// Tiny wildflowers
{
  const flowerRandom = mulberry32(7223);
  for (let i = 0; i < 34; i++) {
    const angle = flowerRandom() * TAU;
    const radius = 4.2 + flowerRandom() * 10.5;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    if (z > 3 && Math.abs(x - pathCenterX(z)) < 0.9) continue;
    if (Math.hypot(x - POND.x, z - POND.z) < POND.r + 0.4) continue;
    const y = terrainHeight(x, z);
    addCylinder(scene, MAT.fern, 0.006, 0.17, x, y + 0.085, z, 6, false, false);
    const head = new THREE.Mesh(GEO.icoLow, flowerRandom() > 0.5 ? MAT.flowerWhite : MAT.flowerGold);
    const s = 0.023 + flowerRandom() * 0.013;
    head.scale.set(s, s * 0.8, s);
    head.position.set(x, y + 0.18, z);
    scene.add(head);
  }
}

// Rocks and boulders
{
  const rockRandom = mulberry32(2877);
  for (let i = 0; i < 31; i++) {
    const angle = rockRandom() * TAU;
    const radius = 4.6 + rockRandom() * 16;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    if (z > 3 && Math.abs(x - pathCenterX(z)) < 1.2) continue;
    if (Math.hypot(x - POND.x, z - POND.z) < POND.r + 0.25) continue;
    const rock = new THREE.Mesh(GEO.rock, MAT.rock[i % 3]);
    const s = 0.18 + Math.pow(rockRandom(), 2) * 0.65;
    rock.scale.set(s * (0.8 + rockRandom() * 0.8), s * (0.5 + rockRandom() * 0.45), s * (0.8 + rockRandom() * 0.7));
    rock.position.set(x, terrainHeight(x, z) + s * 0.3, z);
    rock.rotation.set(rockRandom() * 0.4, rockRandom() * TAU, rockRandom() * 0.3);
    rock.castShadow = true;
    rock.receiveShadow = true;
    scene.add(rock);
  }
}

// A couple of larger boulders at the edge of the clearing.
for (const [x, z, scale] of [[-3.4, 5.0, 0.82], [5.7, 5.1, 0.55], [-6.3, -5.6, 0.7]]) {
  const rock = new THREE.Mesh(GEO.rock, MAT.rock[1]);
  rock.scale.set(scale * 1.3, scale * 0.7, scale);
  rock.position.set(x, terrainHeight(x, z) + scale * 0.2, z);
  rock.rotation.set(0.3, x * 0.2, -0.2);
  rock.castShadow = true;
  rock.receiveShadow = true;
  scene.add(rock);
}


/* -------------------------------------------------------------------------- */
/*  Pond, dock, little angler and fishing props                              */
/* -------------------------------------------------------------------------- */

const WATER_PALETTE = {
  dusk: {
    deep: new THREE.Color(0x071f23),
    shallow: new THREE.Color(0x24544f),
    sky: new THREE.Color(0x738796),
    glow: new THREE.Color(0xffa864),
  },
  day: {
    deep: new THREE.Color(0x174c52),
    shallow: new THREE.Color(0x4e8b7b),
    sky: new THREE.Color(0xb8d4d8),
    glow: new THREE.Color(0xffe8ba),
  },
};

const waterUniforms = {
  uTime: { value: 0 },
  uDeep: { value: WATER_PALETTE.dusk.deep.clone() },
  uShallow: { value: WATER_PALETTE.dusk.shallow.clone() },
  uSky: { value: WATER_PALETTE.dusk.sky.clone() },
  uGlow: { value: WATER_PALETTE.dusk.glow.clone() },
  uLightDir: { value: new THREE.Vector3(0.45, 0.72, 0.52).normalize() },
  uCenter: { value: new THREE.Vector2(POND.x, POND.z) },
  uRadius: { value: POND.r },
  uBobber: { value: new THREE.Vector2(POND.x, POND.z) },
  uBite: { value: 0 },
  uNight: { value: 1 },
};

const waterShape = new THREE.Shape();
{
  const segments = 96;
  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * TAU;
    const radius = POND.r * (1 + 0.055 * Math.sin(angle * 3 + 0.7) + 0.028 * Math.sin(angle * 7 - 1.3) + 0.018 * Math.cos(angle * 11));
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    if (i === 0) waterShape.moveTo(x, y);
    else waterShape.lineTo(x, y);
  }
  waterShape.closePath();
}

const waterGeometry = new THREE.ShapeGeometry(waterShape, 96);
waterGeometry.rotateX(-Math.PI / 2);

const waterMaterial = new THREE.ShaderMaterial({
  uniforms: waterUniforms,
  transparent: true,
  depthWrite: false,
  side: THREE.DoubleSide,
  vertexShader: [
    'varying vec3 vWorldPosition;',
    'void main() {',
    '  vec4 worldPosition = modelMatrix * vec4(position, 1.0);',
    '  vWorldPosition = worldPosition.xyz;',
    '  gl_Position = projectionMatrix * viewMatrix * worldPosition;',
    '}',
  ].join('\n'),
  fragmentShader: [
    'uniform float uTime;',
    'uniform vec3 uDeep;',
    'uniform vec3 uShallow;',
    'uniform vec3 uSky;',
    'uniform vec3 uGlow;',
    'uniform vec3 uLightDir;',
    'uniform vec2 uCenter;',
    'uniform float uRadius;',
    'uniform vec2 uBobber;',
    'uniform float uBite;',
    'uniform float uNight;',
    'varying vec3 vWorldPosition;',
    'void main() {',
    '  vec2 p = vWorldPosition.xz;',
    '  float wave = sin(p.x * 2.3 + uTime * 1.25) * 0.5 + sin(p.y * 3.15 - uTime * 0.92) * 0.5;',
    '  float wave2 = sin((p.x + p.y) * 4.6 + uTime * 2.1) * 0.5;',
    '  vec3 normal = normalize(vec3(wave * 0.034 + wave2 * 0.014, 1.0, wave2 * 0.028));',
    '  vec3 viewDir = normalize(cameraPosition - vWorldPosition);',
    '  float fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), 2.0);',
    '  vec3 color = mix(uDeep, uShallow, 0.34 + wave * 0.13 + wave2 * 0.04);',
    '  color = mix(color, uSky, 0.18 + fresnel * 0.56 + uNight * 0.09);',
    '  float bobberDistance = length(p - uBobber);',
    '  float ring = sin(bobberDistance * 16.0 - uTime * 6.0) * exp(-bobberDistance * 1.2);',
    '  color += vec3(0.5, 0.72, 0.66) * ring * (0.08 + uBite * 0.2);',
    '  vec3 halfVec = normalize(uLightDir + viewDir);',
    '  float specular = pow(max(dot(normal, halfVec), 0.0), 86.0);',
    '  color += uGlow * specular * (0.34 + uNight * 0.42);',
    '  float rim = smoothstep(uRadius * 0.82, uRadius, length(p - uCenter));',
    '  color = mix(color, uShallow * 0.58, rim * 0.5);',
    '  gl_FragColor = vec4(color, 0.91);',
    '  #include <tonemapping_fragment>',
    '  #include <colorspace_fragment>',
    '}',
  ].join('\n'),
});

const water = new THREE.Mesh(waterGeometry, waterMaterial);
water.position.set(POND.x, POND.waterY, POND.z);
water.renderOrder = -2;
water.receiveShadow = false;
scene.add(water);

const pondRandom = mulberry32(4609);
const POND_MAT = {
  reed: new THREE.MeshStandardMaterial({ color: 0x66753f, roughness: 0.95, flatShading: true }),
  cattail: new THREE.MeshStandardMaterial({ color: 0x66412a, roughness: 0.98, flatShading: true }),
  lily: new THREE.MeshStandardMaterial({ color: 0x3f6d4c, roughness: 0.84, flatShading: true }),
  lilyLight: new THREE.MeshStandardMaterial({ color: 0x537c52, roughness: 0.84, flatShading: true }),
  lilyFlower: new THREE.MeshStandardMaterial({ color: 0xe3b7b1, roughness: 0.75, emissive: 0x4b2620, emissiveIntensity: 0.18 }),
  line: new THREE.LineBasicMaterial({ color: 0xe5ddc4, transparent: true, opacity: 0.62, depthWrite: false }),
};

// Shore stones, placed around the bank but leaving the dock entrance open.
for (let i = 0; i < 19; i++) {
  const angle = (i / 19) * TAU + pondRandom() * 0.18;
  if (Math.min(Math.abs(angle), Math.abs(angle - TAU)) < 0.5) continue;
  const distance = POND.r * (0.91 + pondRandom() * 0.17);
  const x = POND.x + Math.cos(angle) * distance;
  const z = POND.z + Math.sin(angle) * distance;
  const y = terrainHeight(x, z);
  const stone = new THREE.Mesh(GEO.rock, MAT.rock[i % 3]);
  const s = 0.22 + pondRandom() * 0.32;
  stone.scale.set(s * 1.3, s * 0.55, s);
  stone.position.set(x, y + s * 0.12, z);
  stone.rotation.set(pondRandom() * 0.25, pondRandom() * TAU, pondRandom() * 0.22);
  stone.castShadow = true;
  stone.receiveShadow = true;
  scene.add(stone);
}

// Cattails and reeds at the far bank.
for (let clump = 0; clump < 8; clump++) {
  const angle = 2.05 + pondRandom() * 3.15;
  const distance = POND.r * (0.89 + pondRandom() * 0.12);
  const cx = POND.x + Math.cos(angle) * distance;
  const cz = POND.z + Math.sin(angle) * distance;
  const baseY = terrainHeight(cx, cz);
  for (let i = 0; i < 4; i++) {
    const x = cx + (pondRandom() - 0.5) * 0.42;
    const z = cz + (pondRandom() - 0.5) * 0.42;
    const height = 0.55 + pondRandom() * 0.55;
    const stem = addCylinder(scene, POND_MAT.reed, 0.009, height, x, baseY + height / 2, z, 6, false, false);
    stem.rotation.z = (pondRandom() - 0.5) * 0.08;
    if (i < 2) {
      addCylinder(scene, POND_MAT.cattail, 0.025, 0.11, x, baseY + height + 0.02, z, 6, false, false);
    }
  }
}

// Lily pads.
{
  const lilyShape = new THREE.Shape();
  lilyShape.moveTo(0, 0);
  lilyShape.absarc(0, 0, 1, 0.18, TAU - 0.18, false);
  lilyShape.lineTo(0, 0);
  const lilyGeometry = new THREE.ShapeGeometry(lilyShape, 18);
  lilyGeometry.rotateX(-Math.PI / 2);

  for (let i = 0; i < 9; i++) {
    const angle = pondRandom() * TAU;
    const distance = 1.2 + pondRandom() * 1.85;
    const x = POND.x + Math.cos(angle) * distance;
    const z = POND.z + Math.sin(angle) * distance;
    if (Math.abs(Math.atan2(z - POND.z, x - POND.x)) < 0.25) continue;
    const pad = new THREE.Mesh(lilyGeometry, i % 3 === 0 ? POND_MAT.lilyLight : POND_MAT.lily);
    const scale = 0.17 + pondRandom() * 0.16;
    pad.scale.set(scale, 1, scale);
    pad.position.set(x, POND.waterY + 0.023, z);
    pad.rotation.y = pondRandom() * TAU;
    pad.receiveShadow = true;
    scene.add(pad);
    if (i === 2 || i === 6) {
      const flower = new THREE.Mesh(GEO.icoLow, POND_MAT.lilyFlower);
      flower.scale.set(0.055, 0.045, 0.055);
      flower.position.set(x, POND.waterY + 0.075, z);
      scene.add(flower);
    }
  }
}

// A stepping-stone branch from the main path to the dock.
for (let i = 0; i < 6; i++) {
  const x = 0.88 - i * 0.67;
  const z = 9.02 + Math.sin(i * 1.35) * 0.22;
  const stone = new THREE.Mesh(GEO.rock, MAT.rock[i % 3]);
  const s = 0.27 + pondRandom() * 0.09;
  stone.scale.set(s * 1.15, s * 0.16, s * 0.82);
  stone.position.set(x, terrainHeight(x, z) + 0.04, z);
  stone.rotation.y = pondRandom() * TAU;
  stone.castShadow = true;
  stone.receiveShadow = true;
  scene.add(stone);
}

// Wooden dock, lantern and a little creel.
const dockGroup = new THREE.Group();
const DOCK_SHORE = { x: -3.02, z: 9.0 };
dockGroup.position.set(DOCK_SHORE.x, 0, DOCK_SHORE.z);
dockGroup.rotation.y = -Math.PI / 2;
scene.add(dockGroup);

for (let i = 0; i < 14; i++) {
  addBox(dockGroup, MAT.deck, 1.18, 0.065, 0.148, 0, 0.18, 0.2 + i * 0.157, true, true);
}
addBox(dockGroup, MAT.darkBeam, 0.12, 0.11, 2.34, -0.51, 0.12, 1.25);
addBox(dockGroup, MAT.darkBeam, 0.12, 0.11, 2.34, 0.51, 0.12, 1.25);
for (const z of [0.42, 1.35, 2.28]) {
  for (const x of [-0.51, 0.51]) {
    addCylinder(dockGroup, MAT.darkBeam, 0.052, 1.35, x, -0.45, z, 6);
  }
}
addBox(dockGroup, MAT.deck, 1.05, 0.1, 0.34, 0, 0.15, 0.02, true, true);
const ramp = addBox(dockGroup, MAT.deck, 1.03, 0.055, 0.72, 0, 0.1, 0.0, true, true);
ramp.rotation.x = -0.3;

// The dock lantern.
{
  addCylinder(dockGroup, MAT.stoneLight, 0.13, 0.3, 0.72, 0.05, 0.35, 8);
  addCylinder(dockGroup, MAT.darkBeam, 0.045, 1.54, 0.72, 0.95, 0.35, 6);
  addBox(dockGroup, MAT.iron, 0.34, 0.05, 0.05, 0.6, 1.66, 0.35);
  addCylinder(dockGroup, MAT.iron, 0.011, 0.13, 0.54, 1.56, 0.35, 6, false, false);
  addBox(dockGroup, MAT.glass, 0.15, 0.2, 0.15, 0.54, 1.42, 0.35, false, false);
  addBox(dockGroup, MAT.iron, 0.2, 0.032, 0.2, 0.54, 1.53, 0.35);
  addBox(dockGroup, MAT.iron, 0.19, 0.03, 0.19, 0.54, 1.31, 0.35);
  const cap = new THREE.Mesh(GEO.cone4, MAT.iron);
  cap.scale.set(0.14, 0.12, 0.14);
  cap.position.set(0.54, 1.59, 0.35);
  dockGroup.add(cap);

  const halo = new THREE.Sprite(windowHaloMaterial.clone());
  halo.material.opacity = 0.3;
  halo.material.userData.baseOpacity = 0.3;
  HALO_MATERIALS.push(halo.material);
  halo.scale.set(1.55, 1.55, 1);
  halo.position.set(0.54, 1.42, 0.35);
  dockGroup.add(halo);

  const light = new THREE.PointLight(0xffa156, 4.2, 5.6, 2);
  light.position.set(0.54, 1.43, 0.35);
  light.userData.baseIntensity = 4.2;
  dockGroup.add(light);
  LANTERN_POINTS.push(light);
}

// A small creel and a wooden stool beside the angler.
{
  const basket = addCylinder(dockGroup, MAT.bark, 0.17, 0.27, -0.41, 0.33, 2.08, 8);
  basket.scale.set(0.17, 0.27, 0.15);
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.012, 6, 14, Math.PI), MAT.darkBeam);
  handle.position.set(-0.41, 0.48, 2.08);
  handle.rotation.x = Math.PI / 2;
  dockGroup.add(handle);

  addBox(dockGroup, MAT.darkBeam, 0.3, 0.22, 0.3, 0.4, 0.29, 2.13);
  addBox(dockGroup, MAT.deck, 0.34, 0.04, 0.34, 0.4, 0.42, 2.13);
}

/* The little angler ------------------------------------------------------- */

const ANGLER_MAT = {
  coat: new THREE.MeshStandardMaterial({ color: 0xb87932, roughness: 0.84, flatShading: true }),
  coatDark: new THREE.MeshStandardMaterial({ color: 0x8e5726, roughness: 0.9, flatShading: true }),
  pants: new THREE.MeshStandardMaterial({ color: 0x394536, roughness: 0.95, flatShading: true }),
  boot: new THREE.MeshStandardMaterial({ color: 0x241b16, roughness: 0.86, flatShading: true }),
  skin: new THREE.MeshStandardMaterial({ color: 0xd39a73, roughness: 0.78, flatShading: true }),
  beanie: new THREE.MeshStandardMaterial({ color: 0x8f3f31, roughness: 0.92, flatShading: true }),
  beanieLight: new THREE.MeshStandardMaterial({ color: 0xb45b43, roughness: 0.92, flatShading: true }),
  scarf: new THREE.MeshStandardMaterial({ color: 0xcfc4a8, roughness: 0.94, flatShading: true }),
  dark: new THREE.MeshStandardMaterial({ color: 0x2a211b, roughness: 0.82, flatShading: true }),
  rod: new THREE.MeshStandardMaterial({ color: 0x6f4529, roughness: 0.72, flatShading: true }),
  reel: new THREE.MeshStandardMaterial({ color: 0x8e7e62, roughness: 0.35, metalness: 0.65 }),
  eye: new THREE.MeshStandardMaterial({ color: 0x211713, roughness: 0.55 }),
  fish: new THREE.MeshStandardMaterial({ color: 0x8d9c8f, roughness: 0.48, metalness: 0.15, flatShading: true }),
  fishBelly: new THREE.MeshStandardMaterial({ color: 0xd8c8a4, roughness: 0.55, flatShading: true }),
  fishFin: new THREE.MeshStandardMaterial({ color: 0x6d5a36, roughness: 0.62, flatShading: true }),
};

function cylinderBetween(parent, material, start, end, radius, segments = 6) {
  const a = start.clone ? start.clone() : new THREE.Vector3(start[0], start[1], start[2]);
  const b = end.clone ? end.clone() : new THREE.Vector3(end[0], end[1], end[2]);
  const direction = b.clone().sub(a);
  const length = direction.length();
  const mesh = addCylinder(parent, material, radius, length, 0, 0, 0, segments);
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  return mesh;
}

const angler = new THREE.Group();
angler.position.set(0, 0.21, 2.22);
angler.rotation.y = 0.28;
angler.scale.setScalar(1.08);
dockGroup.add(angler);

// Boots and legs
for (const side of [-1, 1]) {
  addBox(angler, ANGLER_MAT.boot, 0.13, 0.16, 0.22, side * 0.095, 0.08, 0.035);
  addCylinder(angler, ANGLER_MAT.pants, 0.052, 0.37, side * 0.09, 0.35, 0.0, 6);
}
// Coat and belt
addCylinder(angler, ANGLER_MAT.coat, 0.15, 0.5, 0, 0.76, 0, 8);
addCylinder(angler, ANGLER_MAT.coatDark, 0.225, 0.12, 0, 0.53, 0, 8);
addCylinder(angler, ANGLER_MAT.dark, 0.16, 0.055, 0, 0.59, 0, 8);
// Shoulders
const shoulderL = new THREE.Vector3(-0.215, 0.95, 0.0);
const shoulderR = new THREE.Vector3(0.215, 0.95, 0.0);
const handL = new THREE.Vector3(-0.3, 0.73, 0.12);
const handR = new THREE.Vector3(0.28, 1.03, 0.19);
addCylinder(angler, ANGLER_MAT.coat, 0.06, 0.08, shoulderL.x, shoulderL.y, 0, 6);
addCylinder(angler, ANGLER_MAT.coat, 0.06, 0.08, shoulderR.x, shoulderR.y, 0, 6);
cylinderBetween(angler, ANGLER_MAT.coat, shoulderL, handL, 0.052);
cylinderBetween(angler, ANGLER_MAT.coat, shoulderR, handR, 0.052);
const leftHand = new THREE.Mesh(GEO.sphere, ANGLER_MAT.skin);
leftHand.scale.setScalar(0.043);
leftHand.position.copy(handL);
angler.add(leftHand);
const rightHand = new THREE.Mesh(GEO.sphere, ANGLER_MAT.skin);
rightHand.scale.setScalar(0.045);
rightHand.position.copy(handR);
angler.add(rightHand);

// Head, face and knitted hat. These parts hide when the camera goes first-person.
const firstPersonHeadParts = [];
const anglerHead = new THREE.Mesh(GEO.sphere, ANGLER_MAT.skin);
anglerHead.scale.set(0.148, 0.17, 0.145);
anglerHead.position.set(0, 1.2, 0);
anglerHead.castShadow = true;
angler.add(anglerHead);
firstPersonHeadParts.push(anglerHead);
for (const side of [-1, 1]) {
  const eye = new THREE.Mesh(GEO.sphere, ANGLER_MAT.eye);
  eye.scale.setScalar(0.012);
  eye.position.set(side * 0.047, 1.22, 0.132);
  angler.add(eye);
  firstPersonHeadParts.push(eye);
}
const nose = new THREE.Mesh(GEO.sphere, ANGLER_MAT.skin);
nose.scale.set(0.025, 0.022, 0.022);
nose.position.set(0, 1.18, 0.151);
angler.add(nose);
firstPersonHeadParts.push(nose);

const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.158, 0.166, 0.055, 10), ANGLER_MAT.beanie);
brim.position.set(0, 1.31, -0.008);
brim.castShadow = true;
angler.add(brim);
firstPersonHeadParts.push(brim);
const hatDome = new THREE.Mesh(new THREE.SphereGeometry(0.158, 10, 6, 0, TAU, 0, Math.PI / 2), ANGLER_MAT.beanie);
hatDome.position.set(0, 1.325, -0.008);
hatDome.scale.y = 1.05;
hatDome.castShadow = true;
angler.add(hatDome);
firstPersonHeadParts.push(hatDome);
const pom = new THREE.Mesh(GEO.sphere, ANGLER_MAT.beanieLight);
pom.scale.setScalar(0.045);
pom.position.set(0, 1.515, -0.008);
pom.castShadow = true;
angler.add(pom);
firstPersonHeadParts.push(pom);

const scarf = new THREE.Mesh(new THREE.TorusGeometry(0.135, 0.027, 6, 14), ANGLER_MAT.scarf);
scarf.rotation.x = Math.PI / 2;
scarf.position.set(0, 1.09, 0);
angler.add(scarf);
const scarfTail = addBox(angler, ANGLER_MAT.scarf, 0.085, 0.3, 0.03, -0.09, 0.98, -0.15);
scarfTail.rotation.x = 0.16;
scarfTail.rotation.z = -0.12;

// Creel bag on the hip
addBox(angler, MAT.bark, 0.19, 0.23, 0.1, -0.25, 0.69, -0.02);
addBox(angler, MAT.darkBeam, 0.2, 0.035, 0.11, -0.25, 0.81, -0.02);

// Rod, reel and tip anchor
const rodPivot = new THREE.Group();
rodPivot.position.copy(handR);
angler.add(rodPivot);
const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.022, 1.72, 6), ANGLER_MAT.rod);
rod.position.y = 0.86;
rod.castShadow = true;
rodPivot.add(rod);
const rodTipGuide = new THREE.Object3D();
rodTipGuide.position.y = 1.72;
rodPivot.add(rodTipGuide);
const reel = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.035, 10), ANGLER_MAT.reel);
reel.rotation.z = Math.PI / 2;
reel.position.set(0.07, 0.11, 0.01);
rodPivot.add(reel);
const reelHandle = addCylinder(rodPivot, ANGLER_MAT.dark, 0.009, 0.09, 0.1, 0.11, 0.01, 6, false, false);
reelHandle.rotation.z = Math.PI / 2;
rodPivot.rotation.x = 0.9;

// Bobber
const bobber = new THREE.Group();
const bobberTopMat = new THREE.MeshStandardMaterial({ color: 0xc84b33, roughness: 0.44, emissive: 0x2a0b05, emissiveIntensity: 0.3 });
const bobberBottomMat = new THREE.MeshStandardMaterial({ color: 0xe9dec1, roughness: 0.48 });
const bobberTop = new THREE.Mesh(new THREE.SphereGeometry(0.064, 10, 6, 0, TAU, 0, Math.PI / 2), bobberTopMat);
bobberTop.position.y = 0.002;
bobber.add(bobberTop);
const bobberBottom = new THREE.Mesh(new THREE.SphereGeometry(0.061, 10, 6, 0, TAU, Math.PI / 2, Math.PI / 2), bobberBottomMat);
bobber.add(bobberBottom);
const bobberStem = addCylinder(bobber, ANGLER_MAT.dark, 0.006, 0.11, 0, 0.09, 0, 6, false, false);
bobberStem.castShadow = false;
scene.add(bobber);

// A thin line with a little sag.
const linePointCount = 24;
const linePositions = new Float32Array(linePointCount * 3);
const lineGeometry = new THREE.BufferGeometry();
lineGeometry.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));
const fishingLine = new THREE.Line(lineGeometry, POND_MAT.line);
fishingLine.frustumCulled = false;
scene.add(fishingLine);

// Splash particles.
const splashCount = 30;
const splashPositions = new Float32Array(splashCount * 3);
const splashVelocities = new Float32Array(splashCount * 3);
const splashGeometry = new THREE.BufferGeometry();
splashGeometry.setAttribute('position', new THREE.BufferAttribute(splashPositions, 3));
const splashTexture = canvasTexture(64, 64, (ctx, w, h) => {
  const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.3, 'rgba(235,252,247,0.7)');
  g.addColorStop(1, 'rgba(210,240,235,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}, { clamp: true });
const splashMaterial = new THREE.PointsMaterial({
  map: splashTexture,
  color: 0xc9e8df,
  size: 0.17,
  sizeAttenuation: true,
  transparent: true,
  opacity: 0,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  toneMapped: false,
});
const splash = new THREE.Points(splashGeometry, splashMaterial);
splash.frustumCulled = false;
scene.add(splash);
const splashState = { active: false, life: 0 };
const splashOrigin = new THREE.Vector3();

function triggerSplash(strength = 1) {
  splashOrigin.copy(bobber.position);
  for (let i = 0; i < splashCount; i++) {
    splashPositions[i * 3] = splashOrigin.x + (Math.random() - 0.5) * 0.08;
    splashPositions[i * 3 + 1] = POND.waterY + 0.03;
    splashPositions[i * 3 + 2] = splashOrigin.z + (Math.random() - 0.5) * 0.08;
    const angle = Math.random() * TAU;
    const speed = (0.25 + Math.random() * 0.75) * strength;
    splashVelocities[i * 3] = Math.cos(angle) * speed;
    splashVelocities[i * 3 + 1] = (0.8 + Math.random() * 1.4) * strength;
    splashVelocities[i * 3 + 2] = Math.sin(angle) * speed;
  }
  splashGeometry.attributes.position.needsUpdate = true;
  splashMaterial.opacity = 0.8;
  splashState.active = true;
  splashState.life = 0;
}

function updateSplash(dt) {
  if (!splashState.active) return;
  splashState.life += dt * 2.2;
  const life = Math.min(1, splashState.life);
  for (let i = 0; i < splashCount; i++) {
    splashVelocities[i * 3 + 1] -= 5.8 * dt;
    splashPositions[i * 3] += splashVelocities[i * 3] * dt;
    splashPositions[i * 3 + 1] += splashVelocities[i * 3 + 1] * dt;
    splashPositions[i * 3 + 2] += splashVelocities[i * 3 + 2] * dt;
  }
  splashGeometry.attributes.position.needsUpdate = true;
  splashMaterial.opacity = (1 - life) * 0.8;
  if (life >= 1) {
    splashState.active = false;
    splashMaterial.opacity = 0;
  }
}

// A caught fish, hidden until the player reels one in.
const caughtFish = new THREE.Group();
const fishBody = new THREE.Mesh(GEO.sphere, ANGLER_MAT.fish);
fishBody.scale.set(0.07, 0.1, 0.22);
caughtFish.add(fishBody);
const fishBelly = new THREE.Mesh(GEO.sphere, ANGLER_MAT.fishBelly);
fishBelly.scale.set(0.058, 0.06, 0.18);
fishBelly.position.y = -0.035;
caughtFish.add(fishBelly);
const fishTail = new THREE.Mesh(GEO.cone4, ANGLER_MAT.fishFin);
fishTail.scale.set(0.11, 0.14, 0.022);
fishTail.position.z = -0.26;
fishTail.rotation.x = Math.PI / 2;
caughtFish.add(fishTail);
const fishFin = new THREE.Mesh(GEO.box, ANGLER_MAT.fishFin);
fishFin.scale.set(0.015, 0.1, 0.14);
fishFin.position.set(0, 0.1, 0.02);
fishFin.rotation.x = -0.16;
caughtFish.add(fishFin);
for (const side of [-1, 1]) {
  const eye = new THREE.Mesh(GEO.sphere, ANGLER_MAT.eye);
  eye.scale.setScalar(0.012);
  eye.position.set(side * 0.06, 0.04, 0.165);
  caughtFish.add(eye);
}
caughtFish.visible = false;
scene.add(caughtFish);

// Fishing state machine.
const DEFAULT_BOBBER_POSITION = new THREE.Vector3(POND.x - 0.15, POND.waterY + 0.06, POND.z + 0.28);
const fishing = {
  state: 'idle',
  count: 0,
  castElapsed: 0,
  waitElapsed: 0,
  waitDuration: 4,
  biteElapsed: 0,
  failedElapsed: 0,
  caughtElapsed: 0,
  fishJumpElapsed: 0,
  castFrom: new THREE.Vector3(),
  target: DEFAULT_BOBBER_POSITION.clone(),
  castSwing: 0,
  fish: null,
};
bobber.position.copy(fishing.target);

/* -------------------------------------------------------------------------- */
/*  First-person fishing camera                                               */
/* -------------------------------------------------------------------------- */

const firstPerson = {
  mode: 'off',
  t: 0,
  enterDuration: 0.9,
  exitDuration: 1.0,
  savedPosition: new THREE.Vector3(),
  savedTarget: new THREE.Vector3(),
  savedFov: 42,
  savedQuaternion: new THREE.Quaternion(),
  startPosition: new THREE.Vector3(),
  startQuaternion: new THREE.Quaternion(),
  startFov: 42,
  eye: new THREE.Vector3(),
  look: new THREE.Vector3(),
  targetQuaternion: new THREE.Quaternion(),
  exitTimer: 0,
  headHidden: false,
};

const fpProbe = new THREE.PerspectiveCamera();
const fpEyeLocal = new THREE.Vector3(0.035, 1.225, 0.085);

function setAnglerHeadVisible(visible) {
  firstPerson.headHidden = !visible;
  for (const part of firstPersonHeadParts) part.visible = visible;
}

function setFirstPersonBadge(visible) {
  if (ui.fpBadge) ui.fpBadge.classList.toggle('is-visible', visible);
}

function computeFirstPersonEye(out) {
  angler.updateWorldMatrix(true, false);
  return out.copy(fpEyeLocal).applyMatrix4(angler.matrixWorld);
}

function computeFirstPersonLook(out) {
  const dx = bobber.position.x - firstPerson.eye.x;
  const dz = bobber.position.z - firstPerson.eye.z;
  const length = Math.hypot(dx, dz) || 1;
  return out.set(
    bobber.position.x + (dx / length) * 1.65,
    POND.waterY + 0.52,
    bobber.position.z + (dz / length) * 1.65
  );
}

function computeTargetQuaternion(out) {
  fpProbe.position.copy(firstPerson.eye);
  fpProbe.up.set(0, 1, 0);
  fpProbe.lookAt(firstPerson.look);
  return out.copy(fpProbe.quaternion);
}

function enterFirstPerson() {
  if (firstPerson.mode !== 'off') return;
  if (firstPerson.exitTimer) {
    window.clearTimeout(firstPerson.exitTimer);
    firstPerson.exitTimer = 0;
  }

  firstPerson.savedPosition.copy(camera.position);
  firstPerson.savedTarget.copy(controls.target);
  firstPerson.savedFov = camera.fov;
  firstPerson.startPosition.copy(camera.position);
  firstPerson.startQuaternion.copy(camera.quaternion);
  firstPerson.startFov = camera.fov;
  firstPerson.t = 0;
  firstPerson.mode = 'entering';
  intro.active = false;
  fly = null;
  controls.enabled = false;
  controls.autoRotate = false;
  setFirstPersonBadge(true);
}

function exitFirstPerson() {
  if (firstPerson.mode === 'off' || firstPerson.mode === 'exiting') return;
  if (firstPerson.exitTimer) {
    window.clearTimeout(firstPerson.exitTimer);
    firstPerson.exitTimer = 0;
  }
  firstPerson.startPosition.copy(camera.position);
  firstPerson.startQuaternion.copy(camera.quaternion);
  firstPerson.startFov = camera.fov;
  firstPerson.t = 0;
  firstPerson.mode = 'exiting';
  fpProbe.position.copy(firstPerson.savedPosition);
  fpProbe.up.set(0, 1, 0);
  fpProbe.lookAt(firstPerson.savedTarget);
  firstPerson.savedQuaternion.copy(fpProbe.quaternion);
}

function scheduleFirstPersonExit(delayMs = 1200) {
  if (firstPerson.mode === 'off') return;
  if (firstPerson.exitTimer) window.clearTimeout(firstPerson.exitTimer);
  firstPerson.exitTimer = window.setTimeout(() => {
    firstPerson.exitTimer = 0;
    exitFirstPerson();
  }, delayMs);
}

function updateFirstPerson(dt, time) {
  if (firstPerson.mode === 'off') return;

  if (firstPerson.mode === 'entering') {
    firstPerson.t += dt / firstPerson.enterDuration;
    const k = Math.min(1, firstPerson.t);
    const ease = 1 - Math.pow(1 - k, 3);
    computeFirstPersonEye(firstPerson.eye);
    computeFirstPersonLook(firstPerson.look);
    computeTargetQuaternion(firstPerson.targetQuaternion);
    camera.position.lerpVectors(firstPerson.startPosition, firstPerson.eye, ease);
    camera.quaternion.slerpQuaternions(firstPerson.startQuaternion, firstPerson.targetQuaternion, ease);
    camera.fov = lerp(firstPerson.startFov, 55, ease);
    camera.updateProjectionMatrix();
    if (ease > 0.82 && !firstPerson.headHidden) setAnglerHeadVisible(false);
    if (k >= 1) {
      firstPerson.mode = 'active';
      setAnglerHeadVisible(false);
    }
    return;
  }

  if (firstPerson.mode === 'active') {
    computeFirstPersonEye(firstPerson.eye);
    firstPerson.eye.y += Math.sin(time * 1.25) * 0.004;
    camera.position.copy(firstPerson.eye);
    computeFirstPersonLook(firstPerson.look);
    camera.lookAt(firstPerson.look);
    if (Math.abs(camera.fov - 55) > 0.01) {
      camera.fov = 55;
      camera.updateProjectionMatrix();
    }
    if (!firstPerson.headHidden) setAnglerHeadVisible(false);
    return;
  }

  if (firstPerson.mode === 'exiting') {
    firstPerson.t += dt / firstPerson.exitDuration;
    const k = Math.min(1, firstPerson.t);
    const ease = 1 - Math.pow(1 - k, 3);
    camera.position.lerpVectors(firstPerson.startPosition, firstPerson.savedPosition, ease);
    camera.quaternion.slerpQuaternions(firstPerson.startQuaternion, firstPerson.savedQuaternion, ease);
    camera.fov = lerp(firstPerson.startFov, firstPerson.savedFov, ease);
    camera.updateProjectionMatrix();
    if (ease > 0.55 && firstPerson.headHidden) setAnglerHeadVisible(true);
    if (k >= 1) {
      firstPerson.mode = 'off';
      camera.position.copy(firstPerson.savedPosition);
      camera.quaternion.copy(firstPerson.savedQuaternion);
      camera.fov = firstPerson.savedFov;
      camera.updateProjectionMatrix();
      controls.target.copy(firstPerson.savedTarget);
      controls.enabled = activePanel === null;
      controls.autoRotate = state.autoRotate;
      setAnglerHeadVisible(true);
      setFirstPersonBadge(false);
    }
  }
}


const FISH_TABLE = [
  { name: '虹鳟', min: 24, max: 42 },
  { name: '鲫鱼', min: 13, max: 24 },
  { name: '溪哥', min: 9, max: 16 },
  { name: '鲤鱼', min: 32, max: 56 },
  { name: '山女鳟', min: 18, max: 30 },
];

const RARE_FISH_TABLE = [
  { name: '月影鳟', min: 45, max: 70, period: '夜', rare: true },
  { name: '晨雾鱼', min: 22, max: 38, period: '晨', weather: '雾', rare: true },
  { name: '赤金鲤', min: 40, max: 65, period: '昏', weather: '晴', rare: true },
  { name: '雨鳞鱼', min: 16, max: 30, weather: '雨', rare: true },
];

function chooseFishingFish() {
  const conditions = memory.daily && memory.daily.conditions ? memory.daily.conditions : null;
  if (conditions) {
    const rare = RARE_FISH_TABLE.filter((fish) => {
      if (fish.period && fish.period !== conditions.period) return false;
      if (fish.weather && fish.weather !== conditions.weather) return false;
      return true;
    });
    if (rare.length && Math.random() < 0.1) {
      return rare[Math.floor(Math.random() * rare.length)];
    }
  }
  return FISH_TABLE[Math.floor(Math.random() * FISH_TABLE.length)];
}

function chooseCastTarget() {
  const angle = Math.PI + (Math.random() - 0.5) * 1.15;
  const distance = 0.5 + Math.random() * 2.15;
  return new THREE.Vector3(
    POND.x + Math.cos(angle) * distance,
    POND.waterY + 0.06,
    POND.z + Math.sin(angle) * distance
  );
}

function startFishingCast() {
  if (!['idle', 'caught', 'missed'].includes(fishing.state)) return;
  enterFirstPerson();
  fishing.state = 'casting';
  fishing.castElapsed = 0;
  fishing.castFrom.copy(bobber.position);
  fishing.target.copy(chooseCastTarget());
  fishing.waitDuration = 3.1 + Math.random() * 3.2;
  fishing.castSwing = 0;
  caughtFish.visible = false;
  setFishingHud('casting');
}

function landFishingCatch() {
  if (fishing.state !== 'bite') return;
  const fish = chooseFishingFish();
  const length = Math.floor(fish.min + Math.random() * (fish.max - fish.min + 1));
  fishing.state = 'caught';
  fishing.caughtElapsed = 0;
  fishing.fish = { ...fish, length };
  fishing.count += 1;
  triggerSplash(1.15);
  caughtFish.visible = true;
  caughtFish.position.copy(bobber.position);
  fishing.fishJumpElapsed = 0;
  setFishingHud('caught', fishing.fish);
  rememberFishingCatch(fishing.fish);
  scheduleFirstPersonExit(1200);
}

function updateFishing(dt, time) {
  const state = fishing.state;
  const bobberWorld = bobber.position;

  // Freeze the fishing timers while any panel is open so a bite cannot be
  // missed while reading the backpack, leaderboard or contact card.
  if (activePanel !== null) {
    waterUniforms.uTime.value = time;
    return;
  }

  if (state === 'casting') {
    fishing.castElapsed += dt;
    const k = clamp(fishing.castElapsed / 0.92, 0, 1);
    const eased = k * k * (3 - 2 * k);
    bobberWorld.lerpVectors(fishing.castFrom, fishing.target, eased);
    bobberWorld.y += Math.sin(Math.PI * k) * 0.95;
    fishing.castSwing = Math.sin(Math.PI * Math.min(1, k * 1.3));
    if (k >= 1) {
      fishing.state = 'waiting';
      fishing.waitElapsed = 0;
      bobberWorld.copy(fishing.target);
      triggerSplash(0.32);
      setFishingHud('waiting');
    }
  } else if (state === 'waiting') {
    fishing.waitElapsed += dt;
    bobberWorld.copy(fishing.target);
    bobberWorld.y = POND.waterY + 0.055 + Math.sin(time * 2.1) * 0.012 + Math.sin(time * 0.9) * 0.008;
    fishing.castSwing = Math.max(0, fishing.castSwing - dt * 5);
    if (fishing.waitElapsed >= fishing.waitDuration) {
      fishing.state = 'bite';
      fishing.biteElapsed = 0;
      triggerSplash(0.52);
      setFishingHud('bite');
    }
  } else if (state === 'bite') {
    fishing.biteElapsed += dt;
    bobberWorld.copy(fishing.target);
    bobberWorld.y = POND.waterY + 0.01 + Math.sin(time * 19) * 0.026;
    fishing.castSwing = 0;
    if (fishing.biteElapsed >= BITE_WINDOW) {
      fishing.state = 'missed';
      fishing.failedElapsed = 0;
      fishing.fish = null;
      setFishingHud('missed');
    }
  } else if (state === 'caught') {
    fishing.caughtElapsed += dt;
    bobberWorld.copy(fishing.target);
    bobberWorld.y = POND.waterY + 0.05 + Math.sin(time * 2.4) * 0.01;
    fishing.castSwing = -0.22;
    if (fishing.caughtElapsed > 2.6) {
      fishing.state = 'idle';
      fishing.fish = null;
      setFishingHud('idle');
    }
  } else if (state === 'missed') {
    fishing.failedElapsed += dt;
    bobberWorld.copy(fishing.target);
    bobberWorld.y = POND.waterY + 0.055 + Math.sin(time * 2.1) * 0.01;
    fishing.castSwing = 0;
    if (fishing.failedElapsed > 1.5) {
      fishing.state = 'idle';
      setFishingHud('idle');
    }
  } else {
    bobberWorld.copy(fishing.target);
    bobberWorld.y = POND.waterY + 0.055 + Math.sin(time * 1.8) * 0.01;
    fishing.castSwing = 0;
  }

  // Rod motion: cast snap, bite tug, and a soft bend while reeling.
  let targetRod = 0.9;
  if (fishing.state === 'casting') targetRod = 0.9 + fishing.castSwing * 0.55;
  else if (fishing.state === 'bite') targetRod = 0.98 + Math.sin(time * 16) * 0.028;
  else if (fishing.state === 'caught') targetRod = 0.72;
  else if (fishing.state === 'waiting') targetRod = 0.9 + Math.sin(time * 1.1) * 0.012;
  rodPivot.rotation.x = THREE.MathUtils.damp(rodPivot.rotation.x, targetRod, 9, dt);
  angler.position.y = 0.21 + Math.sin(time * 1.35) * 0.004;
  scarfTail.rotation.x = 0.16 + Math.sin(time * 1.8) * 0.13;
  scarfTail.rotation.z = -0.12 + Math.sin(time * 1.1 + 1.2) * 0.05;

  // Update the line every frame from the rod tip to the float.
  const tipWorld = new THREE.Vector3();
  rodTipGuide.getWorldPosition(tipWorld);
  const sag = fishing.state === 'casting' ? 0.06 : fishing.state === 'caught' ? 0.28 : 0.11;
  const lineEnd = new THREE.Vector3(bobberWorld.x, bobberWorld.y + 0.08, bobberWorld.z);
  const point = new THREE.Vector3();
  for (let i = 0; i < linePointCount; i++) {
    const k = i / (linePointCount - 1);
    point.lerpVectors(tipWorld, lineEnd, k);
    point.y -= Math.sin(Math.PI * k) * sag;
    linePositions[i * 3] = point.x;
    linePositions[i * 3 + 1] = point.y;
    linePositions[i * 3 + 2] = point.z;
  }
  lineGeometry.attributes.position.needsUpdate = true;

  waterUniforms.uTime.value = time;
  waterUniforms.uBobber.value.set(bobberWorld.x, bobberWorld.z);
  const biteTarget = fishing.state === 'bite' ? 1 : 0;
  waterUniforms.uBite.value = lerp(waterUniforms.uBite.value, biteTarget, 1 - Math.exp(-8 * dt));

  if (caughtFish.visible) {
    fishing.fishJumpElapsed += dt;
    const k = clamp(fishing.fishJumpElapsed / 1.15, 0, 1);
    caughtFish.position.set(
      bobberWorld.x + k * 0.22,
      POND.waterY + 0.1 + Math.sin(Math.PI * k) * 1.15,
      bobberWorld.z - k * 0.18
    );
    caughtFish.rotation.x = k * Math.PI * 2.4;
    caughtFish.rotation.z = Math.sin(k * Math.PI * 2) * 0.28;
    if (k >= 1) caughtFish.visible = false;
  }

  updateSplash(dt);
}

/* -------------------------------------------------------------------------- */
/*  Smoke and fireflies                                                      */
/* -------------------------------------------------------------------------- */

const smokeCount = 52;
const smokeData = [];
const smokePositions = new Float32Array(smokeCount * 3);
const smokeSizes = new Float32Array(smokeCount);
const smokeAlphas = new Float32Array(smokeCount);
const smokeGeometry = new THREE.BufferGeometry();
const smokeRandom = mulberry32(7129);

for (let i = 0; i < smokeCount; i++) {
  smokeData.push({
    life: smokeRandom(),
    speed: 0.055 + smokeRandom() * 0.055,
    phase: smokeRandom() * TAU,
    radius: 0.08 + smokeRandom() * 0.22,
    drift: (smokeRandom() - 0.5) * 0.6,
  });
}

function resetSmokeParticle(i, initial = false) {
  const d = smokeData[i];
  d.life = initial ? smokeRandom() : 0;
  d.speed = 0.055 + smokeRandom() * 0.055;
  d.phase = smokeRandom() * TAU;
  d.radius = 0.08 + smokeRandom() * 0.22;
  d.drift = (smokeRandom() - 0.5) * 0.6;
}

const smokeUniforms = {
  uPixelRatio: { value: renderer.getPixelRatio() },
  uOpacity: { value: 0.58 },
};

const smokeMaterial = new THREE.ShaderMaterial({
  uniforms: smokeUniforms,
  transparent: true,
  depthWrite: false,
  blending: THREE.NormalBlending,
  vertexShader: [
    'uniform float uPixelRatio;',
    'attribute float aSize;',
    'attribute float aAlpha;',
    'varying float vAlpha;',
    'void main() {',
    '  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);',
    '  gl_PointSize = aSize * uPixelRatio * (265.0 / max(1.0, -mvPosition.z));',
    '  gl_Position = projectionMatrix * mvPosition;',
    '  vAlpha = aAlpha;',
    '}',
  ].join('\n'),
  fragmentShader: [
    'uniform float uOpacity;',
    'varying float vAlpha;',
    'void main() {',
    '  float d = length(gl_PointCoord - vec2(0.5)) * 2.0;',
    '  float alpha = pow(max(0.0, 1.0 - d), 1.6);',
    '  if (alpha < 0.01) discard;',
    '  gl_FragColor = vec4(vec3(0.66, 0.72, 0.72), alpha * vAlpha * uOpacity);',
    '  #include <colorspace_fragment>',
    '}',
  ].join('\n'),
});
smokeGeometry.setAttribute('position', new THREE.BufferAttribute(smokePositions, 3));
smokeGeometry.setAttribute('aSize', new THREE.BufferAttribute(smokeSizes, 1));
smokeGeometry.setAttribute('aAlpha', new THREE.BufferAttribute(smokeAlphas, 1));
const smoke = new THREE.Points(smokeGeometry, smokeMaterial);
smoke.frustumCulled = false;
scene.add(smoke);

const fireflyCount = 92;
const fireflyData = [];
const fireflyPositions = new Float32Array(fireflyCount * 3);
const fireflySizes = new Float32Array(fireflyCount);
const fireflyPhases = new Float32Array(fireflyCount);
const fireflyGeometry = new THREE.BufferGeometry();
const fireflyRandom = mulberry32(9241);

for (let i = 0; i < fireflyCount; i++) {
  const angle = fireflyRandom() * TAU;
  const radius = 4.7 + Math.pow(fireflyRandom(), 0.65) * 11.5;
  const x = Math.cos(angle) * radius;
  const z = Math.sin(angle) * radius;
  const y = 0.35 + fireflyRandom() * 2.55;
  fireflyData.push({
    x,
    y,
    z,
    phase: fireflyRandom() * TAU,
    speed: 0.22 + fireflyRandom() * 0.4,
    radius: 0.2 + fireflyRandom() * 0.9,
  });
  fireflyPositions[i * 3] = x;
  fireflyPositions[i * 3 + 1] = y;
  fireflyPositions[i * 3 + 2] = z;
  fireflySizes[i] = 0.35 + fireflyRandom() * 0.55;
  fireflyPhases[i] = fireflyRandom();
}
fireflyGeometry.setAttribute('position', new THREE.BufferAttribute(fireflyPositions, 3));
fireflyGeometry.setAttribute('aSize', new THREE.BufferAttribute(fireflySizes, 1));
fireflyGeometry.setAttribute('aPhase', new THREE.BufferAttribute(fireflyPhases, 1));

const fireflyUniforms = {
  uPixelRatio: { value: renderer.getPixelRatio() },
  uTime: { value: 0 },
  uOpacity: { value: 1 },
};
const fireflyMaterial = new THREE.ShaderMaterial({
  uniforms: fireflyUniforms,
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  vertexShader: [
    'uniform float uPixelRatio;',
    'uniform float uTime;',
    'uniform float uOpacity;',
    'attribute float aSize;',
    'attribute float aPhase;',
    'varying float vAlpha;',
    'void main() {',
    '  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);',
    '  float twinkle = 0.42 + 0.58 * pow(0.5 + 0.5 * sin(uTime * 1.75 + aPhase * 6.2831), 2.2);',
    '  vAlpha = uOpacity * twinkle;',
    '  gl_PointSize = aSize * uPixelRatio * (230.0 / max(1.0, -mvPosition.z));',
    '  gl_Position = projectionMatrix * mvPosition;',
    '}',
  ].join('\n'),
  fragmentShader: [
    'varying float vAlpha;',
    'void main() {',
    '  float d = length(gl_PointCoord - vec2(0.5)) * 2.0;',
    '  float halo = pow(max(0.0, 1.0 - d), 1.45);',
    '  float core = pow(max(0.0, 1.0 - d), 4.0);',
    '  vec3 color = mix(vec3(1.0, 0.63, 0.22), vec3(1.0, 0.94, 0.63), core);',
    '  gl_FragColor = vec4(color, (halo * 0.3 + core * 0.9) * vAlpha);',
    '  #include <colorspace_fragment>',
    '}',
  ].join('\n'),
});
const fireflies = new THREE.Points(fireflyGeometry, fireflyMaterial);
fireflies.frustumCulled = false;
scene.add(fireflies);

function updateSmoke(dt) {
  for (let i = 0; i < smokeCount; i++) {
    const d = smokeData[i];
    d.life += dt * d.speed;
    if (d.life > 1) resetSmokeParticle(i);

    const life = d.life;
    const y = CHIMNEY_TOP.y + 0.08 + life * 3.7;
    const spread = 0.08 + life * 0.75;
    const x = CHIMNEY_TOP.x + Math.sin(life * 5.5 + d.phase) * spread + d.drift * life;
    const z = CHIMNEY_TOP.z + Math.cos(life * 4.2 + d.phase * 1.7) * spread * 0.65 - life * 0.32;

    smokePositions[i * 3] = x;
    smokePositions[i * 3 + 1] = y;
    smokePositions[i * 3 + 2] = z;
    smokeSizes[i] = 0.26 + life * 0.95;
    smokeAlphas[i] = Math.sin(Math.PI * life) * 0.36 * (1 - life * 0.22);
  }
  smokeGeometry.attributes.position.needsUpdate = true;
  smokeGeometry.attributes.aSize.needsUpdate = true;
  smokeGeometry.attributes.aAlpha.needsUpdate = true;
}

function updateFireflies(t) {
  for (let i = 0; i < fireflyCount; i++) {
    const d = fireflyData[i];
    const angle = d.phase + t * d.speed;
    const x = d.x + Math.cos(angle) * d.radius + Math.sin(t * 0.43 + d.phase * 2) * 0.18;
    const y = d.y + Math.sin(t * 0.68 + d.phase * 3.1) * 0.2;
    const z = d.z + Math.sin(angle) * d.radius + Math.cos(t * 0.37 + d.phase) * 0.18;
    fireflyPositions[i * 3] = x;
    fireflyPositions[i * 3 + 1] = y;
    fireflyPositions[i * 3 + 2] = z;
  }
  fireflyGeometry.attributes.position.needsUpdate = true;
  fireflyUniforms.uTime.value = t;
}

/* -------------------------------------------------------------------------- */
/*  Day / dusk state and UI                                                  */
/* -------------------------------------------------------------------------- */

const PALETTE = {
  dusk: {
    top: new THREE.Color(0x061020),
    horizon: new THREE.Color(0xa46b58),
    bottom: new THREE.Color(0x08110f),
    glowing: new THREE.Color(0xffbd82),
    fog: new THREE.Color(0x0b1716),
    hemiSky: new THREE.Color(0x6f8eb8),
    hemiGround: new THREE.Color(0x1e2817),
    key: new THREE.Color(0xb9d0ff),
    rim: new THREE.Color(0x45698e),
  },
  day: {
    top: new THREE.Color(0x619fce),
    horizon: new THREE.Color(0xf2d2a9),
    bottom: new THREE.Color(0x7b8e77),
    glowing: new THREE.Color(0xffe3ae),
    fog: new THREE.Color(0xa8bcb3),
    hemiSky: new THREE.Color(0xbad8ed),
    hemiGround: new THREE.Color(0x53623a),
    key: new THREE.Color(0xffe4bb),
    rim: new THREE.Color(0x9eb8c9),
  },
};

const state = {
  day: false,
  mix: 0,
  autoRotate: false,
  time: 0,
};

const ui = {
  lightToggle: document.querySelector('#light-toggle'),
  lightLabel: document.querySelector('#light-label'),
  rotateToggle: document.querySelector('#rotate-toggle'),
  reset: document.querySelector('#reset-view'),
  triCount: document.querySelector('#tri-count'),
  fishingHud: document.querySelector('#fishing-hud'),
  fishingStatus: document.querySelector('#fishing-status'),
  dailyStrip: document.querySelector('#daily-strip'),
  dailyCard: document.querySelector('#daily-card'),
  dailyWeather: document.querySelector('#daily-weather'),
  dailyTarget: document.querySelector('#daily-target'),
  dailyProgress: document.querySelector('#daily-progress'),
  dailyBarFill: document.querySelector('#daily-bar-fill'),
  dailyMeta: document.querySelector('#daily-meta'),
  weatherFx: document.querySelector('#weather-fx'),
  castButton: document.querySelector('#cast-button'),
  castLabel: document.querySelector('#cast-label'),
  catchCount: document.querySelector('#catch-count'),
  catchToast: document.querySelector('#catch-toast'),
  catchDetail: document.querySelector('#catch-detail'),
  memoryToggle: document.querySelector('#memory-toggle'),
  memoryBackdrop: document.querySelector('#memory-backdrop'),
  memoryPanel: document.querySelector('#memory-panel'),
  memoryClose: document.querySelector('#memory-close'),
  memoryForm: document.querySelector('#memory-form'),
  memoryName: document.querySelector('#memory-name'),
  memoryCount: document.querySelector('#memory-count'),
  memorySync: document.querySelector('#memory-sync'),
  memoryError: document.querySelector('#memory-error'),
  memoryLeaderboard: document.querySelector('#memory-leaderboard'),
  backpackTotal: document.querySelector('#backpack-total'),
  backpackSpecies: document.querySelector('#backpack-species'),
  backpackList: document.querySelector('#backpack-list'),
  leaderboardToggle: document.querySelector('#leaderboard-toggle'),
  leaderboardPanel: document.querySelector('#leaderboard-panel'),
  leaderboardClose: document.querySelector('#leaderboard-close'),
  encyclopediaToggle: document.querySelector('#encyclopedia-toggle'),
  encyclopediaPanel: document.querySelector('#encyclopedia-panel'),
  encyclopediaClose: document.querySelector('#encyclopedia-close'),
  encyclopediaGrid: document.querySelector('#encyclopedia-grid'),
  encyclopediaBest: document.querySelector('#encyclopedia-best'),
  announcementToggle: document.querySelector('#announcement-toggle'),
  announcementPanel: document.querySelector('#announcement-panel'),
  announcementClose: document.querySelector('#announcement-close'),
  announcementList: document.querySelector('#announcement-list'),
  contactToggle: document.querySelector('#contact-toggle'),
  contactPanel: document.querySelector('#contact-panel'),
  contactClose: document.querySelector('#contact-close'),
  contactList: document.querySelector('#contact-list'),
  contactStatus: document.querySelector('#contact-status'),
  feedbackToggle: document.querySelector('#feedback-toggle'),
  feedbackPanel: document.querySelector('#feedback-panel'),
  feedbackClose: document.querySelector('#feedback-close'),
  feedbackForm: document.querySelector('#feedback-form'),
  feedbackMessage: document.querySelector('#feedback-message'),
  feedbackContact: document.querySelector('#feedback-contact'),
  feedbackWebsite: document.querySelector('#feedback-website'),
  feedbackSubmit: document.querySelector('#feedback-submit'),
  feedbackStatus: document.querySelector('#feedback-status'),
  fpBadge: document.querySelector('#fp-badge'),
};

let catchToastTimer = 0;

function showCatchToast(fish) {
  if (!ui.catchToast || !ui.catchDetail) return;
  ui.catchDetail.textContent = fish.name + ' · ' + fish.length + ' cm';
  ui.catchToast.classList.add('is-visible');
  window.clearTimeout(catchToastTimer);
  catchToastTimer = window.setTimeout(() => {
    ui.catchToast.classList.remove('is-visible');
  }, 2800);
}

function setFishingHud(mode, fish = null, count = fishing.count) {
  if (!ui.fishingHud || !ui.castButton) return;
  ui.fishingHud.classList.remove('is-bite', 'is-catch');
  ui.catchCount.textContent = String(count);
  ui.castButton.disabled = false;

  if (mode === 'casting') {
    ui.castLabel.textContent = '抛竿中…';
    ui.fishingStatus.textContent = '鱼线划过水面，浮标飞向池塘…';
    ui.castButton.disabled = true;
  } else if (mode === 'waiting') {
    ui.castLabel.textContent = '等待中';
    ui.fishingStatus.textContent = '浮标已入水 · 静候鱼儿咬钩';
    ui.castButton.disabled = true;
  } else if (mode === 'bite') {
    ui.fishingHud.classList.add('is-bite');
    ui.castLabel.textContent = '收线！';
    ui.fishingStatus.textContent = '有鱼咬钩！点击「收线」把它拉上来';
  } else if (mode === 'caught') {
    ui.fishingHud.classList.add('is-catch');
    ui.castLabel.textContent = '再抛一竿';
    ui.fishingStatus.textContent = fish
      ? '钓到' + fish.name + ' · ' + fish.length + ' cm，今晚加餐'
      : '收获一条鱼，今晚加餐';
    ui.castButton.disabled = true;
    window.setTimeout(() => {
      if (fishing.state === 'caught' || fishing.state === 'idle') ui.castButton.disabled = false;
    }, 2200);
    if (fish) showCatchToast(fish);
  } else if (mode === 'missed') {
    ui.castLabel.textContent = '收线中';
    ui.fishingStatus.textContent = '鱼儿跑掉了… 再试一次吧';
    ui.castButton.disabled = true;
  } else {
    ui.castLabel.textContent = '抛竿';
    ui.fishingStatus.textContent = '点击「抛竿」，静候鱼儿咬钩';
  }
}


/* -------------------------------------------------------------------------- */
/*  Server-side backpack: one anonymous data record per browser               */
/* -------------------------------------------------------------------------- */

const MEMORY_API_BASE = '/api/fishing';

const LEGACY_MEMORY_KEY = 'forest-cabin-memory-v1';
const memory = {
  user: null,
  name: '',
  backpack: [],
  species: [],
  leaderboard: [],
  daily: null,
  encyclopedia: [],
  personalBest: null,
  online: false,
  loading: false,
  windowDays: 30,
  legacyUid: null,
  nameError: '',
};

function readLegacyUid() {
  try {
    const raw = window.localStorage ? window.localStorage.getItem(LEGACY_MEMORY_KEY) : null;
    if (!raw) return null;
    const saved = JSON.parse(raw);
    return saved && typeof saved.uid === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(saved.uid) ? saved.uid : null;
  } catch {
    return null;
  }
}

function consumeLegacyUid() {
  if (!memory.legacyUid) return;
  memory.legacyUid = null;
  try {
    if (window.localStorage) window.localStorage.removeItem(LEGACY_MEMORY_KEY);
  } catch {
    // Ignore storage restrictions.
  }
}

function legacyQuery() {
  return memory.legacyUid ? '?legacy_uid=' + encodeURIComponent(memory.legacyUid) : '';
}

memory.legacyUid = readLegacyUid();

function createMemoryId() {
  try {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
  } catch {
    // Fall through to the timestamp-based id.
  }
  return 'v-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
}

async function memoryApi(path, options = {}) {
  if (typeof fetch !== 'function') throw new Error('fetch-unavailable');
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timeoutId = controller ? window.setTimeout(() => controller.abort(), 4500) : 0;
  try {
    const headers = {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    };
    const response = await fetch(MEMORY_API_BASE + path, {
      cache: 'no-store',
      credentials: 'same-origin',
      ...options,
      headers,
      ...(controller ? { signal: controller.signal } : {}),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error((payload && payload.error) || 'HTTP ' + response.status);
      error.status = response.status;
      throw error;
    }
    return payload;
  } finally {
    if (timeoutId) window.clearTimeout(timeoutId);
  }
}

function updateMemoryStatus() {
  if (!ui.memorySync) return;
  ui.memorySync.classList.remove('is-online', 'is-offline', 'is-syncing');
  if (memory.loading) {
    ui.memorySync.classList.add('is-syncing');
    ui.memorySync.textContent = '正在同步背包…';
  } else if (memory.online) {
    ui.memorySync.classList.add('is-online');
    ui.memorySync.textContent = '已连接 · 数据保存在服务器';
  } else {
    ui.memorySync.classList.add('is-offline');
    ui.memorySync.textContent = '未连接 · 背包数据在服务器';
  }
}

function setDisplayedCatchCount(count) {
  const value = Math.max(0, Number(count) || 0);
  fishing.count = value;
  if (ui.catchCount) ui.catchCount.textContent = String(value);
  if (ui.memoryCount) ui.memoryCount.textContent = String(value);
  if (ui.memoryToggle) ui.memoryToggle.title = '钓鱼背包 · 近 30 天 ' + value + ' 条';
}

function formatBackpackDate(timestamp) {
  const date = new Date(Number(timestamp) * 1000);
  if (Number.isNaN(date.getTime())) return '';
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return month + '-' + day + ' ' + hour + ':' + minute;
}

function renderBackpackList() {
  if (!ui.backpackList || typeof ui.backpackList.appendChild !== 'function') return;
  const list = ui.backpackList;
  list.textContent = '';
  if (!memory.backpack.length) {
    const empty = document.createElement('li');
    empty.className = 'memory-empty';
    empty.textContent = memory.online ? '背包还是空的，去钓一条鱼吧' : '连接服务器后才能打开背包';
    list.appendChild(empty);
    return;
  }

  memory.backpack.slice(0, 40).forEach((entry) => {
    const item = document.createElement('li');
    item.className = 'backpack-item';

    const dot = document.createElement('span');
    dot.className = 'backpack-dot';

    const main = document.createElement('div');
    main.className = 'backpack-item-main';
    const name = document.createElement('strong');
    name.textContent = entry.species || '鱼';
    const meta = document.createElement('span');
    meta.textContent = (Number(entry.length) || 0) + ' cm · ' + formatBackpackDate(entry.caughtAt);
    main.append(name, meta);

    const badge = document.createElement('span');
    badge.className = 'backpack-item-badge';
    badge.textContent = '已入包';

    item.append(dot, main, badge);
    list.appendChild(item);
  });
}

function renderSpeciesChips() {
  if (!ui.backpackSpecies || typeof ui.backpackSpecies.appendChild !== 'function') return;
  const wrap = ui.backpackSpecies;
  wrap.textContent = '';
  for (const species of memory.species) {
    const chip = document.createElement('span');
    chip.className = 'backpack-chip';
    chip.textContent = species.name + ' ×' + species.count;
    wrap.appendChild(chip);
  }
}

function renderMemoryLeaderboard() {
  if (!ui.memoryLeaderboard || typeof ui.memoryLeaderboard.appendChild !== 'function') return;
  const list = ui.memoryLeaderboard;
  list.textContent = '';
  if (!memory.leaderboard.length) {
    const empty = document.createElement('li');
    empty.className = 'memory-empty';
    empty.textContent = memory.online ? '还没有人留下渔获，来当第一个' : '连接服务器后显示全站渔获榜';
    list.appendChild(empty);
    return;
  }

  memory.leaderboard.slice(0, 5).forEach((entry, index) => {
    const item = document.createElement('li');
    if (entry.isMe) item.className = 'is-me';
    const rank = document.createElement('span');
    rank.className = 'memory-rank';
    rank.textContent = String(index + 1).padStart(2, '0');
    const name = document.createElement('span');
    name.className = 'memory-name';
    name.textContent = entry.name || '无名钓客';
    const score = document.createElement('span');
    score.className = 'memory-score';
    score.textContent = String(entry.count || 0);
    const unit = document.createElement('small');
    unit.textContent = '条';
    score.appendChild(unit);
    item.append(rank, name, score);
    list.appendChild(item);
  });
}

function escapeGuide(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
  });
}

function applyWeather(weather) {
  if (ui.weatherFx) {
    ui.weatherFx.classList.toggle('is-rain', weather === '雨');
    ui.weatherFx.classList.toggle('is-fog', weather === '雾');
  }
  document.body.dataset.weather = weather || '';
}

function renderDailyQuest() {
  var daily = memory.daily;
  if (!daily) {
    if (ui.dailyStrip) ui.dailyStrip.textContent = '今日目标 · 连接服务器后显示';
    if (ui.dailyTarget) ui.dailyTarget.textContent = '连接服务器后显示';
    if (ui.dailyProgress) ui.dailyProgress.textContent = '0 / 0';
    if (ui.dailyBarFill) ui.dailyBarFill.style.width = '0%';
    if (ui.dailyMeta) ui.dailyMeta.textContent = '连续钓鱼 0 天 · 完成今日目标可延续';
    if (ui.dailyWeather) ui.dailyWeather.textContent = '—';
    if (ui.dailyCard) ui.dailyCard.classList.remove('completed');
    applyWeather(null);
    return;
  }
  var conditions = daily.conditions && typeof daily.conditions === 'object' ? daily.conditions : {};
  var species = String(daily.targetSpecies || '');
  var total = Math.max(1, Number(daily.targetCount) || 1);
  var progress = Math.max(0, Math.min(total, Number(daily.progress) || 0));
  var completed = Boolean(daily.completed);
  var streak = Math.max(0, Number(daily.streak) || 0);
  var bestStreak = Math.max(0, Number(daily.bestStreak) || 0);
  var period = String(conditions.period || '');
  var weather = String(conditions.weather || '');
  var rare = Array.isArray(conditions.rare) ? conditions.rare : [];
  var weatherText = [period, weather].filter(Boolean).join(' · ');
  var rareText = rare.length ? ' · 鱼讯 ' + rare.join(' / ') : '';
  if (ui.dailyStrip) {
    ui.dailyStrip.textContent = completed
      ? '今日目标完成 · 连续 ' + streak + ' 天'
      : '今日 ' + species + ' ' + progress + '/' + total + ' · 连续 ' + streak + ' 天';
  }
  if (ui.dailyTarget) ui.dailyTarget.textContent = completed ? '今日已完成' : '钓 ' + total + ' 条 ' + species;
  if (ui.dailyProgress) ui.dailyProgress.textContent = progress + ' / ' + total;
  if (ui.dailyBarFill) ui.dailyBarFill.style.width = Math.round((progress / total) * 100) + '%';
  if (ui.dailyMeta) {
    ui.dailyMeta.textContent = '连续 ' + streak + ' 天 · 最佳 ' + bestStreak + ' 天' + (weatherText ? ' · ' + weatherText : '') + rareText;
  }
  if (ui.dailyWeather) ui.dailyWeather.textContent = weatherText || '—';
  if (ui.dailyCard) ui.dailyCard.classList.toggle('completed', completed);
  applyWeather(weather);
}

function renderEncyclopedia() {
  if (!ui.encyclopediaGrid) return;
  var list = Array.isArray(memory.encyclopedia) ? memory.encyclopedia : [];
  if (!list.length) {
    ui.encyclopediaGrid.innerHTML = '<div class="memory-empty">连接服务器后读取图鉴</div>';
  } else {
    var html = '';
    list.forEach(function (item) {
      var caught = Boolean(item.caught);
      var rare = Boolean(item.rare);
      var classes = 'fish-card' + (caught ? ' caught' : ' locked') + (rare ? ' rare' : '');
      var glyph = caught ? Array.from(String(item.name || '鱼'))[0] : '?';
      var record = caught ? String(item.bestLength || 0) + ' cm · ' + String(item.count || 0) + ' 条' : '尚未发现';
      html += '<article class="' + classes + '">' +
        (rare ? '<span class="fish-rare-tag">RARE</span>' : '') +
        '<span class="fish-glyph">' + escapeGuide(glyph) + '</span>' +
        '<strong>' + escapeGuide(item.name) + '</strong>' +
        '<span class="fish-record">' + escapeGuide(record) + '</span>' +
        '<small>' + (caught ? '个人最佳' : '继续探索溪流') + '</small>' +
        '</article>';
    });
    ui.encyclopediaGrid.innerHTML = html;
  }
  if (ui.encyclopediaBest) {
    var best = memory.personalBest;
    ui.encyclopediaBest.innerHTML = best
      ? '<span>个人最佳</span><strong>' + escapeGuide(best.species) + ' · ' + String(best.length || 0) + ' cm</strong>'
      : '<span>个人最佳</span><strong>还没有渔获</strong>';
  }
}

function renderMemoryPanel() {
  if (ui.memoryName && document.activeElement !== ui.memoryName) {
    ui.memoryName.value = memory.name;
  }
  if (ui.memoryError) {
    ui.memoryError.textContent = memory.nameError || '';
    ui.memoryError.classList.toggle('is-visible', Boolean(memory.nameError));
  }
  if (ui.memoryCount) ui.memoryCount.textContent = String(fishing.count);
  if (ui.backpackTotal) ui.backpackTotal.textContent = String(fishing.count) + ' 条';
  updateMemoryStatus();
  renderBackpackList();
  renderSpeciesChips();
  renderMemoryLeaderboard();
  renderDailyQuest();
  renderEncyclopedia();
}

function applyBackpackState(data) {
  memory.online = true;
  memory.windowDays = Number(data.windowDays) || 30;
  if (data.user && typeof data.user === 'object') {
    memory.user = data.user;
    memory.name = typeof data.user.name === 'string' ? data.user.name : '';
    if (typeof data.user.count === 'number') setDisplayedCatchCount(data.user.count);
  }
  memory.backpack = Array.isArray(data.backpack) ? data.backpack : [];
  memory.species = Array.isArray(data.species) ? data.species : [];
  memory.leaderboard = Array.isArray(data.leaderboard) ? data.leaderboard : [];
  memory.daily = data.daily && typeof data.daily === 'object' ? data.daily : null;
  memory.encyclopedia = Array.isArray(data.encyclopedia) ? data.encyclopedia : [];
  memory.personalBest = data.personalBest && typeof data.personalBest === 'object' ? data.personalBest : null;
  renderMemoryPanel();
}

async function syncMemory() {
  if (memory.loading) return;
  memory.loading = true;
  updateMemoryStatus();
  try {
    const data = await memoryApi('/me' + legacyQuery());
    applyBackpackState(data);
    consumeLegacyUid();
  } catch {
    memory.online = false;
  } finally {
    memory.loading = false;
    updateMemoryStatus();
    renderMemoryPanel();
  }
}

function rememberFishingCatch(fish) {
  const eventId = createMemoryId();
  memory.loading = true;
  updateMemoryStatus();

  if (typeof fetch !== 'function') {
    memory.loading = false;
    memory.online = false;
    updateMemoryStatus();
    renderMemoryPanel();
    return;
  }

  memoryApi('/catch' + legacyQuery(), {
    method: 'POST',
    body: JSON.stringify({
      event_id: eventId,
      species: String(fish.name || '鱼'),
      length: Number(fish.length) || 0,
    }),
  }).then((data) => {
    memory.online = true;
    applyBackpackState(data);
    consumeLegacyUid();
  }).catch(() => {
    memory.online = false;
  }).finally(() => {
    memory.loading = false;
    updateMemoryStatus();
    renderMemoryPanel();
  });
}

async function saveMemoryName(event) {
  event.preventDefault();
  if (!ui.memoryName) return;
  const previousName = memory.name;
  const nextName = Array.from(ui.memoryName.value.trim()).slice(0, 12).join('');
  memory.name = nextName;
  memory.nameError = '';
  memory.loading = true;
  updateMemoryStatus();
  renderMemoryPanel();
  try {
    const data = await memoryApi('/profile' + legacyQuery(), {
      method: 'POST',
      body: JSON.stringify({ name: nextName }),
    });
    memory.online = true;
    consumeLegacyUid();
    if (typeof data.name === 'string') memory.name = data.name;
    memory.nameError = '';
  } catch (error) {
    memory.name = previousName;
    if (error && error.status === 409) {
      memory.nameError = error.message || '这个称呼已经有人用了';
    } else {
      memory.online = false;
      memory.nameError = '保存失败，请稍后再试';
    }
  } finally {
    memory.loading = false;
    if (ui.memoryName) ui.memoryName.value = memory.name;
    updateMemoryStatus();
    renderMemoryPanel();
    if (memory.online) syncMemory();
  }
}

let activePanel = null;
let contactStatusTimer = 0;
let feedbackSending = false;

const PANEL_TARGETS = {
  backpack: { panel: ui.memoryPanel, toggle: ui.memoryToggle },
  leaderboard: { panel: ui.leaderboardPanel, toggle: ui.leaderboardToggle },
  encyclopedia: { panel: ui.encyclopediaPanel, toggle: ui.encyclopediaToggle },
  announcement: { panel: ui.announcementPanel, toggle: ui.announcementToggle },
  contact: { panel: ui.contactPanel, toggle: ui.contactToggle },
  feedback: { panel: ui.feedbackPanel, toggle: ui.feedbackToggle },
};

function setPanelVisual(kind, open) {
  const target = PANEL_TARGETS[kind];
  if (!target) return;
  if (target.panel) {
    target.panel.classList.toggle('is-open', open);
    target.panel.setAttribute('aria-hidden', String(!open));
  }
  if (target.toggle) {
    target.toggle.classList.toggle('is-active', open);
    target.toggle.setAttribute('aria-expanded', String(open));
  }
}

function closePanels() {
  for (const kind of Object.keys(PANEL_TARGETS)) setPanelVisual(kind, false);
  activePanel = null;
  if (ui.memoryBackdrop) ui.memoryBackdrop.classList.remove('is-open');
  controls.enabled = firstPerson.mode === 'off';
}

function openPanel(kind) {
  const target = PANEL_TARGETS[kind];
  if (!target || !target.panel) return;
  if (activePanel === kind) {
    closePanels();
    return;
  }
  closePanels();
  activePanel = kind;
  setPanelVisual(kind, true);
  if (ui.memoryBackdrop) ui.memoryBackdrop.classList.add('is-open');
  controls.enabled = false;
  if (kind === 'backpack' || kind === 'leaderboard' || kind === 'encyclopedia') {
    renderMemoryPanel();
    syncMemory();
  }
  if (kind === 'announcement') loadAnnouncements();
  if (kind === 'feedback') setFeedbackStatus('', '');
}

function openMemoryPanel() {
  openPanel('backpack');
}

function closeMemoryPanel() {
  closePanels();
}

function setFeedbackStatus(message, type) {
  if (!ui.feedbackStatus) return;
  ui.feedbackStatus.textContent = message || '';
  ui.feedbackStatus.className = 'feedback-status' + (type ? ' is-' + type : '');
}

async function loadAnnouncements() {
  if (!ui.announcementList) return;
  ui.announcementList.innerHTML = '<div class="memory-empty">正在读取公告…</div>';
  try {
    const response = await fetch('/announcements.json?v=' + Date.now(), { cache: 'no-store' });
    if (!response.ok) throw new Error('announcement fetch failed');
    const data = await response.json();
    const items = Array.isArray(data.announcements) ? data.announcements : [];
    if (!items.length) {
      ui.announcementList.innerHTML = '<div class="announcement-empty">暂时还没有公告。<br>新的公告会先经过站长确认，再出现在这里。</div>';
      return;
    }
    ui.announcementList.innerHTML = '';
    items.forEach((item) => {
      const article = document.createElement('article');
      article.className = 'announcement-item';
      const head = document.createElement('div');
      head.className = 'announcement-item-head';
      const title = document.createElement('h3');
      title.textContent = String(item.title || '林间公告');
      const time = document.createElement('time');
      time.textContent = String(item.date || '');
      head.append(title, time);
      const body = document.createElement('p');
      body.textContent = String(item.body || '');
      article.append(head, body);
      ui.announcementList.appendChild(article);
    });
  } catch {
    ui.announcementList.innerHTML = '<div class="announcement-empty">公告加载失败，请稍后再试。</div>';
  }
}

async function submitFeedback(event) {
  event.preventDefault();
  if (!ui.feedbackForm || feedbackSending) return;
  const message = ui.feedbackMessage ? ui.feedbackMessage.value.trim() : '';
  const contact = ui.feedbackContact ? ui.feedbackContact.value.trim() : '';
  const website = ui.feedbackWebsite ? ui.feedbackWebsite.value : '';
  if (Array.from(message).length < 2) {
    setFeedbackStatus('写点什么再发送吧。', 'error');
    if (ui.feedbackMessage) ui.feedbackMessage.focus();
    return;
  }
  if (typeof fetch !== 'function') {
    setFeedbackStatus('当前浏览器无法提交，请直接发邮件。', 'error');
    return;
  }

  feedbackSending = true;
  if (ui.feedbackSubmit) {
    ui.feedbackSubmit.disabled = true;
    ui.feedbackSubmit.textContent = '发送中…';
  }
  setFeedbackStatus('正在提交…', '');
  try {
    const response = await fetch('/api/fishing/feedback', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        message,
        contact,
        page: window.location.pathname,
        website,
      }),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error((data && data.error) || '提交失败');
      error.status = response.status;
      throw error;
    }
    if (ui.feedbackForm) ui.feedbackForm.reset();
    setFeedbackStatus('已收到，会发送到站长邮箱。谢谢。', 'success');
  } catch (error) {
    setFeedbackStatus(error && error.message ? error.message : '提交失败，请稍后再试。', 'error');
  } finally {
    feedbackSending = false;
    if (ui.feedbackSubmit) {
      ui.feedbackSubmit.disabled = false;
      ui.feedbackSubmit.textContent = '发送反馈';
    }
  }
}

function copyContactValue(value) {
  if (!value) return;
  const fallbackCopy = () => {
    const area = document.createElement('textarea');
    area.value = value;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    try {
      document.execCommand('copy');
      return true;
    } catch {
      return false;
    } finally {
      area.remove();
    }
  };

  const finish = (ok) => {
    if (!ui.contactStatus) return;
    ui.contactStatus.textContent = ok ? '已复制到剪贴板' : '复制失败，请手动选择';
    window.clearTimeout(contactStatusTimer);
    contactStatusTimer = window.setTimeout(() => {
      ui.contactStatus.textContent = 'GitHub / 邮箱点击打开，QQ / 微信点击复制。';
    }, 1800);
  };

  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    navigator.clipboard.writeText(value).then(() => finish(true)).catch(() => finish(fallbackCopy()));
  } else {
    finish(fallbackCopy());
  }
}

if (ui.memoryToggle) ui.memoryToggle.addEventListener('click', () => openPanel('backpack'));
if (ui.leaderboardToggle) ui.leaderboardToggle.addEventListener('click', () => openPanel('leaderboard'));
if (ui.encyclopediaToggle) ui.encyclopediaToggle.addEventListener('click', () => openPanel('encyclopedia'));
if (ui.announcementToggle) ui.announcementToggle.addEventListener('click', () => openPanel('announcement'));
if (ui.contactToggle) ui.contactToggle.addEventListener('click', () => openPanel('contact'));
if (ui.feedbackToggle) ui.feedbackToggle.addEventListener('click', () => openPanel('feedback'));
if (ui.memoryClose) ui.memoryClose.addEventListener('click', closePanels);
if (ui.leaderboardClose) ui.leaderboardClose.addEventListener('click', closePanels);
if (ui.encyclopediaClose) ui.encyclopediaClose.addEventListener('click', closePanels);
if (ui.announcementClose) ui.announcementClose.addEventListener('click', closePanels);
if (ui.contactClose) ui.contactClose.addEventListener('click', closePanels);
if (ui.feedbackClose) ui.feedbackClose.addEventListener('click', closePanels);
if (ui.memoryBackdrop) ui.memoryBackdrop.addEventListener('click', closePanels);
if (ui.memoryForm) ui.memoryForm.addEventListener('submit', saveMemoryName);
if (ui.feedbackForm) ui.feedbackForm.addEventListener('submit', submitFeedback);
if (ui.memoryName) {
  ui.memoryName.addEventListener('input', () => {
    if (!memory.nameError) return;
    memory.nameError = '';
    renderMemoryPanel();
  });
}
if (ui.contactList) {
  ui.contactList.addEventListener('click', (event) => {
    const row = event.target.closest('[data-copy]');
    if (!row) return;
    copyContactValue(row.getAttribute('data-copy'));
  });
}
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && activePanel !== null) closePanels();
});

syncMemory();

ui.castButton.addEventListener('click', () => {
  if (fishing.state === 'bite') landFishingCatch();
  else if (fishing.state === 'idle' || fishing.state === 'caught' || fishing.state === 'missed') startFishingCast();
});

setFishingHud('idle', null, fishing.count);

ui.lightToggle.addEventListener('click', () => {
  state.day = !state.day;
  ui.lightToggle.setAttribute('aria-pressed', String(state.day));
  ui.lightLabel.textContent = state.day ? '白昼' : '黄昏';
});

ui.rotateToggle.addEventListener('click', () => {
  if (firstPerson.mode !== 'off') return;
  state.autoRotate = !state.autoRotate;
  ui.rotateToggle.classList.toggle('is-active', state.autoRotate);
  ui.rotateToggle.setAttribute('aria-pressed', String(state.autoRotate));
});

let fly = null;

function startFlyTo(position, target, duration = 1.45) {
  fly = {
    t: 0,
    duration,
    fromPosition: camera.position.clone(),
    fromTarget: controls.target.clone(),
    toPosition: position.clone(),
    toTarget: target.clone(),
  };
  controls.autoRotate = false;
}

ui.reset.addEventListener('click', () => {
  if (firstPerson.mode !== 'off') return;
  startFlyTo(HOME_POSITION, HOME_TARGET, 1.35);
});

controls.addEventListener('start', () => {
  if (fly) {
    fly = null;
    controls.autoRotate = state.autoRotate;
  }
});

function updateDayNight(dt) {
  state.mix = THREE.MathUtils.damp(state.mix, state.day ? 1 : 0, 2.35, dt);
  const t = state.mix;
  const dusk = PALETTE.dusk;
  const day = PALETTE.day;

  skyUniforms.uTopColor.value.copy(dusk.top).lerp(day.top, t);
  skyUniforms.uHorizonColor.value.copy(dusk.horizon).lerp(day.horizon, t);
  skyUniforms.uBottomColor.value.copy(dusk.bottom).lerp(day.bottom, t);
  skyUniforms.uGlowColor.value.copy(dusk.glowing).lerp(day.glowing, t);
  skyUniforms.uGlowStrength.value = lerp(0.42, 0.18, t);

  scene.fog.color.copy(dusk.fog).lerp(day.fog, t);
  scene.fog.density = lerp(0.0175, 0.0092, t);

  waterUniforms.uDeep.value.copy(WATER_PALETTE.dusk.deep).lerp(WATER_PALETTE.day.deep, t);
  waterUniforms.uShallow.value.copy(WATER_PALETTE.dusk.shallow).lerp(WATER_PALETTE.day.shallow, t);
  waterUniforms.uSky.value.copy(WATER_PALETTE.dusk.sky).lerp(WATER_PALETTE.day.sky, t);
  waterUniforms.uGlow.value.copy(WATER_PALETTE.dusk.glow).lerp(WATER_PALETTE.day.glow, t);
  waterUniforms.uNight.value = 1 - t;

  hemiLight.color.copy(dusk.hemiSky).lerp(day.hemiSky, t);
  hemiLight.groundColor.copy(dusk.hemiGround).lerp(day.hemiGround, t);
  hemiLight.intensity = lerp(0.75, 1.35, t);

  keyLight.color.copy(dusk.key).lerp(day.key, t);
  keyLight.intensity = lerp(2.25, 2.7, t);
  rimLight.color.copy(dusk.rim).lerp(day.rim, t);
  rimLight.intensity = lerp(0.62, 0.45, t);

  renderer.toneMappingExposure = lerp(1.12, 1.04, t);
  moonMaterial.color.copy(new THREE.Color(0xf3eedb)).lerp(new THREE.Color(0xffe2a6), t);
  moonGlowMaterial.color.copy(new THREE.Color(0xffddaa)).lerp(new THREE.Color(0xffe9bf), t);
  moonGlowMaterial.opacity = lerp(0.32, 0.18, t);

  for (const light of WINDOW_LIGHTS) light.intensity = light.userData.baseIntensity * lerp(1, 0.36, t) * light.userData.flicker;
  for (const light of LANTERN_POINTS) light.intensity = light.userData.baseIntensity * lerp(1, 0.42, t) * light.userData.flicker;
  if (CONFIG_DOOR_LIGHT) CONFIG_DOOR_LIGHT.intensity = CONFIG_DOOR_LIGHT.userData.baseIntensity * lerp(1, 0.34, t) * CONFIG_DOOR_LIGHT.userData.flicker;

  MAT.glass.emissiveIntensity = lerp(2.25, 1.05, t);
  for (const material of HALO_MATERIALS) {
    material.opacity = (material.userData.baseOpacity ?? 0.3) * lerp(1, 0.34, t);
  }
  for (const pool of LIGHT_POOLS) {
    const base = pool.userData.baseOpacity ?? 0.2;
    pool.material.opacity = base * lerp(1, 0.15, t);
  }
  fireflyUniforms.uOpacity.value = lerp(1, 0, t);
  smokeUniforms.uOpacity.value = lerp(0.58, 0.3, t);
  for (const material of starMaterials) material.opacity = (material.userData?.baseOpacity ?? 0.82) * (1 - t);
}

// The base opacities of the star materials are captured once for fading.
starMaterials[0].userData.baseOpacity = 0.82;
starMaterials[1].userData.baseOpacity = 0.9;

// Give each point light its own flicker phase.
for (const light of WINDOW_LIGHTS) light.userData.flicker = 1;
for (const light of LANTERN_POINTS) light.userData.flicker = 1;
if (CONFIG_DOOR_LIGHT) CONFIG_DOOR_LIGHT.userData.flicker = 1;

/* -------------------------------------------------------------------------- */
/*  Intro fly-in, resize, stats                                              */
/* -------------------------------------------------------------------------- */

const intro = {
  active: true,
  t: 0,
  duration: 2.6,
  fromPosition: camera.position.clone(),
  fromTarget: controls.target.clone(),
};

function updateIntro(dt) {
  if (!intro.active) return;
  intro.t += dt / intro.duration;
  const k = Math.min(1, intro.t);
  const ease = 1 - Math.pow(1 - k, 3);
  camera.position.lerpVectors(intro.fromPosition, HOME_POSITION, ease);
  controls.target.lerpVectors(intro.fromTarget, HOME_TARGET, ease);
  if (k >= 1) {
    intro.active = false;
    controls.autoRotate = state.autoRotate;
  }
}

function updateFly(dt) {
  if (!fly) return;
  fly.t += dt / fly.duration;
  const k = Math.min(1, fly.t);
  const ease = 1 - Math.pow(1 - k, 3);
  camera.position.lerpVectors(fly.fromPosition, fly.toPosition, ease);
  controls.target.lerpVectors(fly.fromTarget, fly.toTarget, ease);
  if (k >= 1) {
    fly = null;
    controls.autoRotate = state.autoRotate;
  }
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  if (firstPerson.mode === 'off') {
    applyResponsiveFov();
  } else {
    camera.fov = 55;
    camera.updateProjectionMatrix();
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, PIXEL_RATIO_CAP));
  renderer.setSize(window.innerWidth, window.innerHeight);
  smokeUniforms.uPixelRatio.value = renderer.getPixelRatio();
  fireflyUniforms.uPixelRatio.value = renderer.getPixelRatio();
});

function calculateTriangles() {
  let triangles = 0;
  scene.traverse((object) => {
    if (!object.isMesh || !object.geometry) return;
    const geometry = object.geometry;
    const count = geometry.index ? geometry.index.count : geometry.attributes.position.count;
    triangles += (count / 3) * (object.isInstancedMesh ? object.count : 1);
  });
  return Math.round(triangles);
}

const triangleCount = calculateTriangles();
ui.triCount.textContent = (triangleCount / 1000).toFixed(1).replace('.0', '') + 'k 三角面';

/* -------------------------------------------------------------------------- */
/*  Animation loop                                                           */
/* -------------------------------------------------------------------------- */

const clock = new THREE.Clock();
let firstFrame = true;
const SHOT_MODE = new URLSearchParams(window.location.search).has('shot');

function animate() {
  requestAnimationFrame(animate);
  if (document.hidden) return;
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;
  state.time = t;

  updateDayNight(dt);
  if (firstPerson.mode === 'off') {
    updateIntro(dt);
    updateFly(dt);
  }

  // gentle individual light flicker
  for (let i = 0; i < WINDOW_LIGHTS.length; i++) {
    const light = WINDOW_LIGHTS[i];
    light.userData.flicker = 0.94 + 0.06 * Math.sin(t * 2.3 + i * 1.9) + 0.02 * Math.sin(t * 7.1 + i);
  }
  for (let i = 0; i < LANTERN_POINTS.length; i++) {
    const light = LANTERN_POINTS[i];
    light.userData.flicker = 0.9 + 0.1 * Math.sin(t * 3.1 + i * 2.2) + 0.035 * Math.sin(t * 8.3 + i);
  }
  if (CONFIG_DOOR_LIGHT) {
    CONFIG_DOOR_LIGHT.userData.flicker = 0.94 + 0.06 * Math.sin(t * 2.8 + 1.2);
  }

  for (let i = 0; i < LANTERN_PIVOTS.length; i++) {
    const pivot = LANTERN_PIVOTS[i];
    pivot.rotation.z = Math.sin(t * 0.72 + i) * 0.035;
    pivot.rotation.x = Math.cos(t * 0.53 + i) * 0.018;
  }

  for (let i = 0; i < swayTrees.length; i++) {
    const canopy = swayTrees[i];
    canopy.rotation.z = Math.sin(t * 0.34 + canopy.userData.phase) * 0.007;
    canopy.rotation.x = Math.cos(t * 0.27 + canopy.userData.phase * 1.7) * 0.005;
  }

  updateSmoke(dt);
  updateFireflies(t);
  updateFishing(dt, t);
  updateFirstPerson(dt, t);

  moonGlowMaterial.opacity = lerp(0.32, 0.18, state.mix) * (0.92 + 0.08 * Math.sin(t * 0.7));
  for (const material of starMaterials) {
    const base = material.userData?.baseOpacity ?? 0.82;
    material.opacity = base * (1 - state.mix) * (0.92 + 0.08 * Math.sin(t * 1.3 + base * 10));
  }

  if (firstPerson.mode === 'off') {
    if (!fly) {
      controls.autoRotate = state.autoRotate && !intro.active;
    }
    controls.update();
  }
  renderer.render(scene, camera);

  if (firstFrame) {
    firstFrame = false;
    window.__SCENE_READY__ = true;
    window.setTimeout(() => {
      document.querySelector('#loader').classList.add('is-hidden');
    }, 420);
  }
}

window.__CABIN__ = { THREE, scene, camera, controls, cabin, moon, state, water, angler, fishing, bobber, firstPerson, startFishingCast, landFishingCatch, updateFishing, updateFirstPerson, exitFirstPerson, terrainHeight, POND, memory, syncMemory, openMemoryPanel, closeMemoryPanel, openPanel };

if (SHOT_MODE) {
  intro.active = false;
  fly = null;
  state.autoRotate = false;
  controls.autoRotate = false;
  camera.position.copy(HOME_POSITION);
  controls.target.copy(HOME_TARGET);
  controls.update();
  updateDayNight(0);
  updateSmoke(0.55);
  updateFireflies(0);
  updateFishing(0, 0);
  moonGlowMaterial.opacity = 0.32;
  smokeUniforms.uOpacity.value = 0.58;
  fireflyUniforms.uOpacity.value = 1;
  for (const material of HALO_MATERIALS) material.opacity = material.userData.baseOpacity ?? 0.3;
  for (const pool of LIGHT_POOLS) pool.material.opacity = pool.userData.baseOpacity ?? 0.2;
  for (const light of WINDOW_LIGHTS) light.intensity = light.userData.baseIntensity;
  for (const light of LANTERN_POINTS) light.intensity = light.userData.baseIntensity;
  if (CONFIG_DOOR_LIGHT) CONFIG_DOOR_LIGHT.intensity = CONFIG_DOOR_LIGHT.userData.baseIntensity;
  renderer.render(scene, camera);
  window.__SCENE_READY__ = true;
  const loader = document.querySelector('#loader');
  if (loader) loader.remove();
} else {
  animate();
}

window.addEventListener('error', (event) => {
  const text = document.querySelector('.loader-text');
  if (text) text.textContent = '场景加载失败：' + (event.message || '未知错误');
  console.error(event.error || event.message);
});
