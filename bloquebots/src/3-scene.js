
// ---------- Mesa, suelo y decorado ----------
{
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), MAT.floor);
  floor.rotation.x = -Math.PI / 2; floor.position.y = FLOOR_Y; floor.receiveShadow = true;
  scene.add(floor);
  addStatic(new CANNON.Box(new CANNON.Vec3(200, 1, 200)), { x: 0, y: FLOOR_Y - 1, z: 0 });
  const rug = new THREE.Mesh(new THREE.CircleGeometry(100, 64), MAT.rug);
  rug.rotation.x = -Math.PI / 2; rug.position.y = FLOOR_Y + 0.05; rug.receiveShadow = true;
  scene.add(rug);
}

const BLOCK_GEO = new THREE.BoxGeometry(BL, BH, BW);
const BLOCK_SHAPE = new CANNON.Box(new CANNON.Vec3(BL / 2, BH / 2, BW / 2));
const Q_ORIENT = {
  x: new THREE.Quaternion(),
  z: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2),
  v: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2),
};

function makeBlock(pos, quat, material, kind = 'block', mass = 1) {
  return addDynamic({ shape: BLOCK_SHAPE, mass, material: PM.wood, mesh: new THREE.Mesh(BLOCK_GEO, material), kind, pos, quat });
}

function makeBook(w, h, d, color, pos, yaw) {
  const cover = new THREE.MeshStandardMaterial({ color, roughness: 0.8 });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [MAT.pages, cover, cover, cover, MAT.pages, MAT.pages]);
  const quat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  return addDynamic({ shape: new CANNON.Box(new CANNON.Vec3(w / 2, h / 2, d / 2)), mass: 10, material: PM.table, mesh, kind: 'prop', pos, quat });
}

function makeMug(pos) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 1.7, 4, 28), MAT.mug);
  const coffee = new THREE.Mesh(new THREE.CircleGeometry(1.6, 24), new THREE.MeshStandardMaterial({ color: 0x3b2314, roughness: 0.2 }));
  coffee.rotation.x = -Math.PI / 2; coffee.position.y = 1.7;
  const handle = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.28, 10, 20), MAT.mug);
  handle.position.x = 2.0;
  for (const m of [body, handle]) { m.castShadow = true; m.receiveShadow = true; }
  g.add(body, coffee, handle);
  return addDynamic({ shape: new CANNON.Cylinder(1.8, 1.7, 4, 14), mass: 4, material: PM.table, mesh: g, kind: 'prop', pos });
}

// ---------- Ventilador de pie: marca de dónde viene el viento ----------
const fan = new THREE.Group();
const fanHead = new THREE.Group();
const fanBlades = new THREE.Group();
{
  const base = new THREE.Mesh(new THREE.CylinderGeometry(5, 5.5, 1, 32), MAT.fanDark);
  base.position.y = FLOOR_Y + 0.5;
  const poleH = 9 - FLOOR_Y;
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, poleH, 12), MAT.fan);
  pole.position.y = FLOOR_Y + poleH / 2;
  const motor = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.9, 3.2, 20), MAT.fan);
  motor.rotation.x = Math.PI / 2; motor.position.z = -1.8;
  const ringGeo = new THREE.TorusGeometry(6.2, 0.14, 8, 48);
  const ring1 = new THREE.Mesh(ringGeo, MAT.fanDark), ring2 = new THREE.Mesh(ringGeo, MAT.fanDark);
  ring1.position.z = 0.9; ring2.position.z = -0.6;
  for (let i = 0; i < 3; i++) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(1.8, 5.2, 0.12), new THREE.MeshStandardMaterial({ color: 0x9fd3f0, transparent: true, opacity: 0.8, roughness: 0.3 }));
    blade.position.y = 2.9; blade.rotation.y = 0.35;
    const arm = new THREE.Group(); arm.rotation.z = (i * Math.PI * 2) / 3; arm.add(blade);
    fanBlades.add(arm);
  }
  fanBlades.add(new THREE.Mesh(new THREE.SphereGeometry(0.9, 16, 12), MAT.fanDark));
  fanHead.add(motor, ring1, ring2, fanBlades);
  fanHead.position.y = 9;
  fan.add(base, pole, fanHead);
  fan.traverse((m) => { if (m.isMesh) m.castShadow = true; });
  scene.add(fan);
}
let fanAngle = 0, fanAngleTarget = 0, fanSpin = 0;
function updateFan(dt, windStrength) {
  let d = fanAngleTarget - fanAngle;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  fanAngle += d * Math.min(1, dt * 2.5);
  // El ventilador se coloca en el lado del que sopla el viento, mirando al centro
  const r = TABLE.hx + 28;
  fan.position.set(-Math.cos(fanAngle) * r, 0, -Math.sin(fanAngle) * r);
  fan.lookAt(0, 0, 0);
  fanSpin += dt * (1 + windStrength * 7);
  fanBlades.rotation.z = -fanSpin * 6;
}

// ---------- Robots ----------
// Cada pieza: p = posición local (el robot mira hacia +X), o = orientación del bloque
function standardDesign() {
  const b = [];
  for (const z of [-0.9, 0.9]) b.push({ p: [0, 0.3, z], o: 'x' });                       // pies
  for (const x of [-0.8, 0.8]) for (const z of [-0.9, 0.9]) b.push({ p: [x, 2.1, z], o: 'v' }); // piernas
  for (const x of [-0.8, 0.8]) b.push({ p: [x, 3.9, 0], o: 'z' });                         // cadera
  for (const z of [-1, 0, 1]) b.push({ p: [0, 4.5, z], o: 'x' });                          // torso
  for (const x of [-1, 0, 1]) b.push({ p: [x, 5.1, 0], o: 'z' });
  for (const x of [-1, 1]) b.push({ p: [x, 5.7, 0], o: 'z' });
  for (const z of [-1.6, 1.6]) b.push({ p: [0, 5.7, z], o: 'z' });                       // brazos
  for (const z of [-1, 0, 1]) b.push({ p: [0, 6.3, z], o: 'x' });                          // hombros
  for (const z of [-1, 1]) b.push({ p: [0, 6.9, z], o: 'x' });                             // cabina
  return { name: 'Alto', blocks: b, die: [0, 6.6 + DIE / 2, 0] };
}

function tankDesign() {
  const b = [];
  for (const z of [-1, 0, 1]) b.push({ p: [0, 0.3, z], o: 'x' });
  for (const x of [-1, 0, 1]) b.push({ p: [x, 0.9, 0], o: 'z' });
  for (const z of [-1, 0, 1]) b.push({ p: [0, 1.5, z], o: 'x' });
  for (const x of [-1, 0, 1]) b.push({ p: [x, 2.1, 0], o: 'z' });
  for (const z of [-1, 1]) b.push({ p: [0, 2.7, z], o: 'x' });
  b.push({ p: [1.4, 2.7, 0], o: 'x' });                                                    // cañón
  for (const x of [-1, 0, 1]) b.push({ p: [x, 3.3, 0], o: 'z' });
  for (const z of [-1, 1]) b.push({ p: [0, 3.9, z], o: 'x' });                             // cabina
  return { name: 'Tanque', blocks: b, die: [0, 3.6 + DIE / 2, 0] };
}

function towerDesign() {
  const b = [];
  for (const z of [-0.9, 0.9]) b.push({ p: [0, 0.3, z], o: 'x' });
  for (const x of [-0.8, 0.8]) for (const z of [-0.9, 0.9]) b.push({ p: [x, 2.1, z], o: 'v' });   // piernas de abajo
  for (const x of [-0.8, 0.8]) b.push({ p: [x, 3.9, 0], o: 'z' });                           // rodillas
  for (const x of [-0.8, 0.8]) for (const z of [-0.9, 0.9]) b.push({ p: [x, 5.7, z], o: 'v' });   // piernas de arriba
  for (const x of [-0.8, 0.8]) b.push({ p: [x, 7.5, 0], o: 'z' });                           // cadera
  for (const z of [-1, 0, 1]) b.push({ p: [0, 8.1, z], o: 'x' });
  for (const x of [-1, 0, 1]) b.push({ p: [x, 8.7, 0], o: 'z' });
  for (const x of [-1, 1]) b.push({ p: [x, 9.3, 0], o: 'z' });
  for (const z of [-1.6, 1.6]) b.push({ p: [0, 9.3, z], o: 'z' });                         // brazos
  for (const z of [-1, 0, 1]) b.push({ p: [0, 9.9, z], o: 'x' });
  for (const z of [-1, 1]) b.push({ p: [0, 10.5, z], o: 'x' });                              // cabina
  return { name: 'Torre', blocks: b, die: [0, 10.2 + DIE / 2, 0] };
}

function miniDesign() {
  const b = [];
  for (const z of [-0.6, 0.6]) b.push({ p: [0, 0.3, z], o: 'x' });
  for (const x of [-1, 0, 1]) b.push({ p: [x, 0.9, 0], o: 'z' });
  for (const z of [-1, 1]) b.push({ p: [0, 1.5, z], o: 'x' });                               // cabina
  return { name: 'Mini', blocks: b, die: [0, 1.2 + DIE / 2, 0] };
}

// Catálogo para elegir equipo. Altura y aguante van de 1 a 5.
const DESIGNS = {
  alto: { make: standardDesign, name: 'Alto', desc: 'Equilibrado. Dispara desde media altura y aguanta golpes normales.', altura: 3, aguante: 3 },
  tanque: { make: tankDesign, name: 'Tanque', desc: 'Bajo y pesado. Cuesta mucho tumbarlo, pero dispara desde abajo.', altura: 2, aguante: 5 },
  torre: { make: towerDesign, name: 'Torre', desc: 'Dispara desde muy arriba, pero se tambalea con cualquier golpe.', altura: 5, aguante: 1 },
  mini: { make: miniDesign, name: 'Mini', desc: 'Pequeño y difícil de acertar, aunque un buen golpe lo manda a volar.', altura: 1, aguante: 2 },
};

// Miniaturas de cada modelo para la pantalla de selección (un solo render temporal)
function makeThumbs() {
  const out = { red: {}, blue: {} };
  let r;
  try {
    r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    r.setSize(160, 160, false);
    r.toneMapping = THREE.ACESFilmicToneMapping;
    for (const team of ['red', 'blue']) for (const key of Object.keys(DESIGNS)) {
      const s = new THREE.Scene();
      s.add(new THREE.HemisphereLight(0xfff1dc, 0x3a2a20, 1.3));
      const l = new THREE.DirectionalLight(0xffe2b8, 2.2); l.position.set(8, 12, 10); s.add(l);
      const d = DESIGNS[key].make();
      let top = 0;
      for (const piece of d.blocks) {
        const m = new THREE.Mesh(BLOCK_GEO, MAT[team]);
        m.position.set(...piece.p); m.quaternion.copy(piece.q ? new THREE.Quaternion(...piece.q) : Q_ORIENT[piece.o]); s.add(m);
        top = Math.max(top, piece.p[1] + 0.3);
      }
      const die = new THREE.Mesh(new THREE.BoxGeometry(DIE, DIE, DIE), DIE_MAT[team]);
      die.position.set(...d.die); if (d.dieQ) die.quaternion.set(...d.dieQ); s.add(die);
      // Misma escala para todos los modelos (así se nota cuál es más alto), salvo los muy altos
      const k = Math.max(1, top / 11);
      const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 200);
      cam.position.set(15 * k, 11 * k, 16 * k); cam.lookAt(0, 5 * k, 0);
      r.render(s, cam);
      out[team][key] = r.domElement.toDataURL('image/png');
    }
  } catch { /* sin miniaturas: las tarjetas muestran solo texto */ }
  if (r) { r.dispose(); r.forceContextLoss(); }
  return out;
}

function makeLabel(text, color) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true, sizeAttenuation: false }));
  spr.scale.set(0.15, 0.0375, 1); spr.renderOrder = 10;
  spr.userData.draw = (label, out, active) => {
    g.clearRect(0, 0, 256, 64);
    g.fillStyle = out ? 'rgba(60,50,45,.75)' : 'rgba(30,20,12,.8)';
    g.beginPath(); g.roundRect(8, 8, 240, 48, 14); g.fill();
    if (active) { g.strokeStyle = '#f2b134'; g.lineWidth = 5; g.stroke(); }
    g.fillStyle = out ? '#9a8f86' : color;
    g.font = '400 26px Bungee, "Arial Black", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(out ? '✖ ' + label : label, 128, 34);
    tex.needsUpdate = true;
  };
  spr.userData.draw(text, false, false);
  scene.add(spr);
  return spr;
}

const robots = [];
function buildRobot(design, team, x, z, facing, idx) {
  const qFacing = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), facing);
  const origin = new THREE.Vector3(x, TABLE.top + 0.002, z);
  const toWorld = (p) => new THREE.Vector3(...p).applyQuaternion(qFacing).add(origin);
  const blocks = design.blocks.map((piece) => {
    const q = qFacing.clone().multiply(piece.q ? new THREE.Quaternion(...piece.q) : Q_ORIENT[piece.o]);
    return makeBlock(toWorld(piece.p), q, MAT[team]);
  });
  const diePos = toWorld(design.die);
  const die = addDynamic({
    shape: new CANNON.Box(new CANNON.Vec3(DIE / 2, DIE / 2, DIE / 2)), mass: 0.35, material: PM.die,
    mesh: new THREE.Mesh(new THREE.BoxGeometry(DIE, DIE, DIE), DIE_MAT[team]), kind: 'die', pos: diePos,
    quat: design.dieQ ? qFacing.clone().multiply(new THREE.Quaternion(...design.dieQ)) : qFacing,
  });
  const name = `${TEAM_NAMES[team]} ${design.name}`;
  const robot = { team, idx, name, short: design.name, blocks, die, alive: true, facing, yaw: facing, dieStartY: diePos.y - TABLE.top, home: origin.clone(), label: makeLabel(name, team === 'red' ? '#ff8a7e' : '#8fb8ff') };
  die.robot = robot;
  for (const b of blocks) b.robot = robot;
  robots.push(robot);
  return robot;
}
