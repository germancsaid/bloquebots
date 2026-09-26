
// ---------- Mapas: cada uno cambia la mesa, los obstáculos y la luz ----------
function canvasTexture(w, h, draw, repeat) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); }
  return t;
}
const TABLE_MATS = {
  wood: MAT.table,
  cloth: new THREE.MeshStandardMaterial({ roughness: 0.95, map: canvasTexture(64, 64, (g) => {
    g.fillStyle = '#f4efe6'; g.fillRect(0, 0, 64, 64);
    g.fillStyle = 'rgba(196,48,43,.85)'; g.fillRect(0, 0, 32, 32); g.fillRect(32, 32, 32, 32);
    g.fillStyle = 'rgba(196,48,43,.35)'; g.fillRect(32, 0, 32, 32); g.fillRect(0, 32, 32, 32);
  }, [16, 10]) }),
  dark: new THREE.MeshStandardMaterial({ map: woodTexture('#4a2e1f', '#1c100a', { w: 1024, h: 512, lines: 160, border: false, seed: 21 }), roughness: 0.45 }),
  blue: new THREE.MeshStandardMaterial({ color: 0x6f9fd8, roughness: 0.7 }),
};

let tableTop = null, tableBody = null, tableLegs = [];
function buildTable(hx, hz, mat) {
  if (tableTop) {
    scene.remove(tableTop); tableTop.geometry.dispose(); world.removeBody(tableBody);
    for (const l of tableLegs) scene.remove(l);
    tableLegs = [];
  }
  TABLE.hx = hx; TABLE.hz = hz;
  tableTop = new THREE.Mesh(new THREE.BoxGeometry(hx * 2, 1.2, hz * 2), mat);
  tableTop.position.y = TABLE.top - 0.6; tableTop.receiveShadow = true; tableTop.castShadow = true; tableTop.name = 'tableTop';
  scene.add(tableTop);
  tableBody = addStatic(new CANNON.Box(new CANNON.Vec3(hx, 0.6, hz)), { x: 0, y: TABLE.top - 0.6, z: 0 });
  const legGeo = new THREE.BoxGeometry(2.2, -FLOOR_Y - 1.2, 2.2);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const leg = new THREE.Mesh(legGeo, MAT.leg);
    leg.position.set(sx * (hx - 2.5), (FLOOR_Y - 1.2) / 2, sz * (hz - 2.5));
    leg.castShadow = true; scene.add(leg); tableLegs.push(leg);
  }
}

// Obstáculos con física
function makeBox(w, h, d, material, pos, yaw = 0, mass = 6) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  const quat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  return addDynamic({ shape: new CANNON.Box(new CANNON.Vec3(w / 2, h / 2, d / 2)), mass, material: PM.table, mesh, kind: 'prop', pos, quat });
}
function makeCylinder(r, h, material, pos, mass = 3) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 24), material);
  return addDynamic({ shape: new CANNON.Cylinder(r, r, h, 14), mass, material: PM.table, mesh, kind: 'prop', pos });
}
function makeBall(r, material, pos, mass = 1.2) {
  const t = addDynamic({ shape: new CANNON.Sphere(r), mass, material: PM.table, mesh: new THREE.Mesh(new THREE.SphereGeometry(r, 24, 16), material), kind: 'prop', pos });
  t.body.linearDamping = 0.35; t.body.angularDamping = 0.5;   // que no rueden para siempre
  return t;
}
const labelMat = (text, bg, fg, font = 900) => new THREE.MeshStandardMaterial({ roughness: 0.6, map: canvasTexture(256, 256, (g) => {
  g.fillStyle = bg; g.fillRect(0, 0, 256, 256);
  g.strokeStyle = 'rgba(0,0,0,.25)'; g.lineWidth = 14; g.strokeRect(0, 0, 256, 256);
  g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `${font} ${text.length > 2 ? 64 : 150}px Bungee, "Arial Black", sans-serif`;
  g.fillText(text, 128, 136);
}) });
const colorMat = (c, rough = 0.6, extra = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: rough, ...extra });

const DEFAULT_SPAWNS = { red: [[-46, -14], [-50, 14]], blue: [[46, 14], [50, -14]] };
const BOOK_COLORS = [0x2f6b4f, 0x8c2f3c, 0x2b3f73, 0xc98a2e, 0x5b3f7a, 0x2f6b6b];
function bookStack(x, z, n, yaw = 0) {
  for (let i = 0; i < n; i++) makeBook(10 - i * 0.6, 1.5, 7 - i * 0.3, BOOK_COLORS[(i + Math.abs(Math.round(x + z))) % BOOK_COLORS.length], { x: x + rand(-0.2, 0.2), y: 0.75 + i * 1.5, z: z + rand(-0.2, 0.2) }, yaw + rand(-0.12, 0.12));
}
const MAPS = {
  escritorio: {
    name: 'Escritorio', desc: 'Una mesa enorme llena de pilas de libros y tazas para cubrirte.',
    size: [64, 40], table: 'wood', bg: 0x5d4231, sun: 0xffe2b8,
    props() {
      bookStack(0, 0, 3, 0.1); bookStack(-24, 16, 2, 0.6); bookStack(24, -16, 2, -0.5);
      bookStack(-8, -26, 1, 0.3); bookStack(10, 27, 1, -0.2); bookStack(-30, -8, 2, 1.2); bookStack(31, 8, 2, 1.4);
      makeMug({ x: -16, y: 2.0, z: -28 }); makeMug({ x: 18, y: 2.0, z: 25 }); makeMug({ x: 6, y: 2.0, z: -12 });
    },
  },
  cocina: {
    name: 'Cocina', desc: 'Mantel de cuadros gigante: cajas de cereales, platos, botellas y naranjas que ruedan.',
    size: [64, 40], table: 'cloth', bg: 0x6f8a80, sun: 0xfff6e6,
    props() {
      makeBox(7, 12, 2.6, labelMat('COPOS', '#f2b134', '#8a2a12'), { x: 0, y: 6, z: 1 }, 0.1, 5);
      makeBox(6, 10, 2.4, labelMat('MIEL', '#3a78d0', '#fff8ee'), { x: -26, y: 5, z: -14 }, 0.9, 5);
      makeBox(6, 10, 2.4, labelMat('AVENA', '#2f9a5a', '#fff8ee'), { x: 27, y: 5, z: 14 }, -0.7, 5);
      const plate = colorMat(0xf7f7f2, 0.25);
      for (const [x, z] of [[-12, -26], [14, 26], [30, -24]]) for (let i = 0; i < 4; i++) makeCylinder(3.2, 0.45, plate, { x, y: 0.23 + i * 0.46, z }, 1.5);
      const orange = colorMat(0xf08a1c, 0.55);
      for (const [x, z] of [[10, 18], [12.3, 19.2], [-14, 20], [-15.8, 21.8], [22, -6], [24, -7.5]]) makeBall(1.1, orange, { x, y: 1.1, z });
      const glass = colorMat(0x2f7a4a, 0.15, { transparent: true, opacity: 0.8 });
      for (const [x, z] of [[-6, 28], [32, 26], [-34, 24], [4, -30]]) makeCylinder(1.2, 7, glass, { x, y: 3.5, z }, 2.5);
    },
  },
  muro: {
    name: 'Muro de libros', desc: 'Una muralla de libros cruza toda la mesa: rodéala, tírala o dispara bombeado.',
    size: [64, 40], table: 'dark', bg: 0x3f3040, sun: 0xffd9a8,
    props() {
      [[-31.2, 2], [-20.8, 4], [-10.4, 5], [0, 6], [10.4, 5], [20.8, 4], [31.2, 2]].forEach(([z, n], c) => {
        for (let i = 0; i < n; i++) makeBook(7, 1.5, 10.2, BOOK_COLORS[(i + c * 2) % BOOK_COLORS.length], { x: rand(-0.25, 0.25), y: 0.75 + i * 1.5, z }, rand(-0.03, 0.03));
      });
      bookStack(-28, 0, 3, 1.5); bookStack(28, 0, 3, 1.5);
    },
  },
  estrecha: {
    name: 'Mesa estrecha', desc: 'Larguísima y angosta: poco sitio para esquivar y mucho para caerse.',
    size: [64, 16], table: 'wood', bg: 0x4c3b2c, sun: 0xffe2b8,
    spawns: { red: [[-46, -5], [-54, 5]], blue: [[46, 5], [54, -5]] },
    props() {
      makeBox(8, 2.2, 3, colorMat(0x3a6ea5, 0.5), { x: 0, y: 1.1, z: 0 }, 0.2, 4);
      makeBox(8, 2.2, 3, colorMat(0xd9463b, 0.5), { x: -24, y: 1.1, z: 6 }, -0.3, 4);
      makeBox(8, 2.2, 3, colorMat(0x2f9a5a, 0.5), { x: 24, y: 1.1, z: -6 }, 0.3, 4);
      makeCylinder(0.35, 12, colorMat(0xf2c230, 0.5), { x: -12, y: 6.01, z: -4 }, 0.4);
      makeCylinder(0.35, 12, colorMat(0xf2c230, 0.5), { x: 12, y: 6.01, z: 4 }, 0.4);
    },
  },
  juguetes: {
    name: 'Cuarto de juguetes', desc: 'Pirámides de cubos gigantes, pelotas y camiones por toda la mesa.',
    size: [64, 40], table: 'blue', bg: 0x4b4470, sun: 0xfff0f6,
    props() {
      const cube = (l, bg, x, y, z, yaw = rand(-0.08, 0.08)) => makeBox(4, 4, 4, labelMat(l, bg, '#fff8ee'), { x, y, z }, yaw, 3);
      cube('A', '#d9463b', 0, 2, -4.3); cube('B', '#3a78d0', 0, 2, 0); cube('C', '#2f9a5a', 0, 2, 4.3);
      cube('D', '#f2b134', 0, 6, -2.15); cube('E', '#8a4fd0', 0, 6, 2.15); cube('F', '#e0703a', 0, 10, 0);
      cube('G', '#3a78d0', -24, 2, -16); cube('H', '#d9463b', -24, 6, -16);
      cube('I', '#2f9a5a', 24, 2, 16); cube('J', '#f2b134', 24, 6, 16);
      cube('K', '#8a4fd0', -30, 2, 12); cube('L', '#e0703a', 30, 2, -12);
      makeBall(2, colorMat(0xe8423b, 0.4), { x: 16, y: 2, z: -24 }, 2);
      makeBall(2.6, colorMat(0x3a78d0, 0.4), { x: -18, y: 2.6, z: 25 }, 2.5);
      makeBox(8, 3.5, 4, colorMat(0xf2b134, 0.5), { x: -8, y: 1.75, z: 27 }, 0.3, 5);
      makeBox(3, 2.5, 3.6, colorMat(0x3a78d0, 0.4), { x: -11.2, y: 4.8, z: 28.1 }, 0.3, 1.5);
      makeBox(8, 3.5, 4, colorMat(0xd9463b, 0.5), { x: 10, y: 1.75, z: -28 }, -0.2, 5);
    },
  },
};

function applyMap(key) {
  const m = MAPS[key] || MAPS.escritorio;
  buildTable(m.size[0], m.size[1], TABLE_MATS[m.table]);
  scene.background.set(m.bg); scene.fog.color.set(m.bg);
  sun.color.set(m.sun);
  m.props();
  return m;
}
