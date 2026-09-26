import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js';
import * as CANNON from 'https://cdn.jsdelivr.net/npm/cannon-es@0.20.0/dist/cannon-es.js';

// ---------- Escala: 1 unidad ≈ 2.5 cm. Un bloque mide 7.5 × 2.5 × 1.5 cm como un Jenga real ----------
const BL = 3.0, BW = 1.0, BH = 0.6;          // largo, ancho, alto de un bloque
const DIE = 0.8;                             // lado del dado piloto
const GRAVITY = -30;
const TABLE = { hx: 32, hz: 20, top: 0 };    // mesa de 64 × 40
const FLOOR_Y = -26;
const TEAM_COLORS = { red: 0xd9463b, blue: 0x3a78d0 };
const TEAM_NAMES = { red: 'Rojo', blue: 'Azul' };

const $ = (id) => document.getElementById(id);
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- Render ----------
const canvas = $('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x5d4231);
scene.fog = new THREE.Fog(0x5d4231, 150, 330);

const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 700);
camera.position.set(-40, 22, 30);

scene.add(new THREE.HemisphereLight(0xfff1dc, 0x3a2a20, 1.1));
const sun = new THREE.DirectionalLight(0xffe2b8, 2.2);
sun.position.set(-50, 90, 40);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, { left: -80, right: 80, top: 60, bottom: -60, near: 10, far: 240 });
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.02;
scene.add(sun);
const fill = new THREE.DirectionalLight(0xbcd4ff, 0.45);
fill.position.set(30, 20, -25);
scene.add(fill);

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// ---------- Texturas hechas en canvas (sin archivos externos) ----------
function woodTexture(base, dark, { w = 256, h = 64, lines = 26, border = true, seed = 1 } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, w, h);
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < lines; i++) {
    const y = rnd() * h, amp = 1 + rnd() * 3, freq = 0.01 + rnd() * 0.03, ph = rnd() * 6;
    g.strokeStyle = dark; g.globalAlpha = 0.08 + rnd() * 0.18; g.lineWidth = 0.6 + rnd() * 1.6;
    g.beginPath();
    for (let x = 0; x <= w; x += 4) g.lineTo(x, y + Math.sin(x * freq + ph) * amp);
    g.stroke();
  }
  g.globalAlpha = 1;
  if (border) { g.strokeStyle = 'rgba(40,20,5,0.35)'; g.lineWidth = 3; g.strokeRect(1.5, 1.5, w - 3, h - 3); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function dieMaterials(bg, pip) {
  const layouts = { 1: [[.5,.5]], 2: [[.27,.27],[.73,.73]], 3: [[.27,.27],[.5,.5],[.73,.73]],
    4: [[.27,.27],[.73,.27],[.27,.73],[.73,.73]], 5: [[.27,.27],[.73,.27],[.5,.5],[.27,.73],[.73,.73]],
    6: [[.27,.25],[.73,.25],[.27,.5],[.73,.5],[.27,.75],[.73,.75]] };
  // Orden de caras en BoxGeometry: +x, -x, +y, -y, +z, -z (las opuestas suman 7)
  return [2, 5, 1, 6, 3, 4].map((n) => {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d');
    g.fillStyle = bg; g.fillRect(0, 0, 128, 128);
    g.strokeStyle = 'rgba(0,0,0,.25)'; g.lineWidth = 8; g.strokeRect(0, 0, 128, 128);
    g.fillStyle = pip;
    for (const [x, y] of layouts[n]) { g.beginPath(); g.arc(x * 128, y * 128, 12, 0, Math.PI * 2); g.fill(); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    return new THREE.MeshStandardMaterial({ map: t, roughness: 0.35 });
  });
}

const MAT = {
  wood: new THREE.MeshStandardMaterial({ map: woodTexture('#e2bd84', '#8a5a2b', { seed: 7 }), roughness: 0.72 }),
  red: new THREE.MeshStandardMaterial({ map: woodTexture('#d9564a', '#7a1e16', { seed: 3 }), roughness: 0.68 }),
  blue: new THREE.MeshStandardMaterial({ map: woodTexture('#4f86d6', '#1c3a72', { seed: 5 }), roughness: 0.68 }),
  table: new THREE.MeshStandardMaterial({ map: woodTexture('#8b5a36', '#3b2112', { w: 1024, h: 512, lines: 140, border: false, seed: 11 }), roughness: 0.6 }),
  leg: new THREE.MeshStandardMaterial({ color: 0x6e4428, roughness: 0.7 }),
  floor: new THREE.MeshStandardMaterial({ color: 0x4a3326, roughness: 0.95 }),
  rug: new THREE.MeshStandardMaterial({ color: 0x9c3d34, roughness: 1 }),
  pages: new THREE.MeshStandardMaterial({ color: 0xf1e6cf, roughness: 0.9 }),
  mug: new THREE.MeshStandardMaterial({ color: 0xf4efe6, roughness: 0.3 }),
  fan: new THREE.MeshStandardMaterial({ color: 0xdfe6ea, roughness: 0.4, metalness: 0.2 }),
  fanDark: new THREE.MeshStandardMaterial({ color: 0x5a6670, roughness: 0.5, metalness: 0.3 }),
};
MAT.table.map.wrapS = MAT.table.map.wrapT = THREE.RepeatWrapping;
const DIE_MAT = { red: dieMaterials('#d8352a', '#fff8ee'), blue: dieMaterials('#2f6fd1', '#fff8ee') };

// ---------- Física ----------
const world = new CANNON.World({ gravity: new CANNON.Vec3(0, GRAVITY, 0) });
world.allowSleep = true;
world.broadphase = new CANNON.SAPBroadphase(world);
world.solver.iterations = 20;
world.solver.tolerance = 1e-5;

const PM = { wood: new CANNON.Material('wood'), die: new CANNON.Material('die'), table: new CANNON.Material('table') };
const contact = (a, b, friction, restitution) => world.addContactMaterial(new CANNON.ContactMaterial(a, b, {
  friction, restitution, contactEquationStiffness: 5e7, contactEquationRelaxation: 3,
  frictionEquationStiffness: 5e7, frictionEquationRelaxation: 3,
}));
contact(PM.wood, PM.wood, 0.6, 0.05);
contact(PM.wood, PM.table, 0.6, 0.05);
contact(PM.die, PM.wood, 0.55, 0.1);
contact(PM.die, PM.table, 0.5, 0.2);
contact(PM.die, PM.die, 0.5, 0.2);
contact(PM.table, PM.table, 0.6, 0.05);

// Cada cuerpo dinámico con su malla: { body, mesh, kind, ... }
const things = [];

function addStatic(shape, pos, material = PM.table, quat) {
  const b = new CANNON.Body({ mass: 0, material });
  b.addShape(shape);
  b.position.set(pos.x, pos.y, pos.z);
  if (quat) b.quaternion.copy(quat);
  world.addBody(b);
  return b;
}

function addDynamic({ shape, mass, material, mesh, kind, pos, quat }) {
  const body = new CANNON.Body({ mass, material, linearDamping: 0.04, angularDamping: 0.12 });
  body.addShape(shape);
  body.position.set(pos.x, pos.y, pos.z);
  if (quat) body.quaternion.set(quat.x, quat.y, quat.z, quat.w);
  body.allowSleep = true;
  body.sleepSpeedLimit = 0.2;
  body.sleepTimeLimit = 0.35;
  world.addBody(body);
  mesh.castShadow = true; mesh.receiveShadow = true;
  scene.add(mesh);
  const t = { body, mesh, kind };
  body.userData = t;
  body.addEventListener('collide', onAnyCollide);
  things.push(t);
  syncMesh(t);
  return t;
}

function syncMesh(t) {
  t.mesh.position.copy(t.body.position);
  t.mesh.quaternion.copy(t.body.quaternion);
}

function removeThing(t) {
  world.removeBody(t.body);
  scene.remove(t.mesh);
  const i = things.indexOf(t);
  if (i >= 0) things.splice(i, 1);
}
