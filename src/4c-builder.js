
// ---------- Taller: diseña tu propio robot ----------
// Los bloques se colocan con física real: se apoyan en lo que haya debajo y,
// si quedan mal apoyados, se caen como en la vida real.
const PLATE = 5, MAX_BLOCKS = 40, MAX_HEIGHT = 16, MAX_SAVED = 12;
const STORE_KEY = 'bloquebots.robots.v1';
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const POSES = ['tumbado', 'de canto', 'de pie'];
const TOOL_HINT = {
  block: 'Clic en la mesa o sobre un bloque para ponerlo. Arrastra para girar la cámara.',
  die: 'Pon el dado piloto encima de un bloque. Solo hay uno: si lo pones otra vez, se mueve.',
  erase: 'Clic en un bloque para quitarlo. Lo que tenga encima puede caerse.',
};
const B = { tool: 'block', turn: 0, pose: 0, blocks: [], die: null, extra: [], undo: [], editingId: null, camYaw: 0.7, camPitch: 0.5, camDist: 20, last: null, confirmDelete: 0 };

// Cuadrícula de la zona de construcción y flecha que marca el frente del robot
const buildDeco = new THREE.Group();
{
  const grid = new THREE.GridHelper(PLATE * 2, PLATE * 4, 0xf2b134, 0xe8cfa6);
  grid.position.y = 0.015;
  grid.material.transparent = true; grid.material.opacity = 0.45;
  const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.8, 1.8, 3), new THREE.MeshBasicMaterial({ color: 0xf2b134 }));
  arrow.rotation.z = -Math.PI / 2; arrow.position.set(PLATE + 1.4, 0.4, 0);
  const lbl = makeLabel('Frente', '#f2b134');
  lbl.position.set(PLATE + 1.6, 1.8, 0);
  buildDeco.add(grid, arrow, lbl);
  buildDeco.visible = false;
  scene.add(buildDeco);
}

const ghostMat = new THREE.MeshBasicMaterial({ color: 0x7ee08a, transparent: true, opacity: 0.45, depthWrite: false });
const eraseMat = new THREE.MeshBasicMaterial({ color: 0xff5a4a, transparent: true, opacity: 0.5, depthWrite: false });
const ghost = new THREE.Mesh(BLOCK_GEO, ghostMat);
const ghostDie = new THREE.Mesh(new THREE.BoxGeometry(DIE, DIE, DIE), ghostMat);
const ghostErase = new THREE.Mesh(BLOCK_GEO, eraseMat);
ghostErase.scale.setScalar(1.05);
for (const g of [ghost, ghostDie, ghostErase]) { g.visible = false; g.renderOrder = 5; scene.add(g); }

// ---------- Guardado (en este navegador) ----------
function loadCustoms() { try { return JSON.parse(localStorage.getItem(STORE_KEY) || '[]'); } catch { return []; } }
function persistCustoms() { try { localStorage.setItem(STORE_KEY, JSON.stringify(CUSTOMS)); return true; } catch { return false; } }
let CUSTOMS = loadCustoms();
function registerCustoms() {
  for (const k of Object.keys(DESIGNS)) if (DESIGNS[k].custom) delete DESIGNS[k];
  for (const d of CUSTOMS) {
    const top = Math.max(...d.blocks.map((b) => b.p[1])) + 0.5;
    DESIGNS['c_' + d.id] = {
      custom: true, id: d.id, name: d.name, count: d.blocks.length, altura: clamp(Math.round(top / 2.4), 1, 5),
      desc: 'Diseñado por ti en el taller.',
      make: () => ({ name: d.name, blocks: d.blocks, die: d.die.p, dieQ: d.die.q }),
    };
  }
  THUMBS = null;
}
registerCustoms();

// ---------- Utilidades ----------
const vec = (a) => new THREE.Vector3(a[0], a[1], a[2]);
const quat = (a) => new THREE.Quaternion(a[0], a[1], a[2], a[3]);
const poseOf = (t) => ({ p: [t.body.position.x, t.body.position.y, t.body.position.z], q: [t.body.quaternion.x, t.body.quaternion.y, t.body.quaternion.z, t.body.quaternion.w] });
const built = () => [...B.blocks, ...(B.die ? [B.die] : []), ...B.extra];
function status(msg) { $('b-status').textContent = msg; }

function lazySleep(t) { t.body.sleepSpeedLimit = 0.06; t.body.sleepTimeLimit = 1.2; return t; }
function makeBuildBlock(pos, q) { return lazySleep(makeBlock(pos, q, MAT.wood, 'build')); }
function makeDieThing(pos, q, team) {
  return lazySleep(addDynamic({
    shape: new CANNON.Box(new CANNON.Vec3(DIE / 2, DIE / 2, DIE / 2)), mass: 0.35, material: PM.die,
    mesh: new THREE.Mesh(new THREE.BoxGeometry(DIE, DIE, DIE), DIE_MAT[team]), kind: 'die', pos, quat: q,
  }));
}
function pieceQuat(turn, pose) {
  const q = new THREE.Quaternion();
  if (pose === 1) q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);      // de canto
  if (pose === 2) q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);      // de pie
  return new THREE.Quaternion().setFromAxisAngle(Y_AXIS, turn * Math.PI / 2).multiply(q);
}
function halfExtents(q) {
  const e = new THREE.Vector3(BL / 2, BH / 2, BW / 2).applyQuaternion(q);
  return e.set(Math.abs(e.x), Math.abs(e.y), Math.abs(e.z));
}
function wakeBuilt() { for (const t of built()) t.body.wakeUp(); }
function updateCount() {
  const top = B.blocks.length ? unionBox(B.blocks).max.y : 0;
  $('b-count').textContent = `Bloques ${B.blocks.length}/${MAX_BLOCKS} · Altura ${Math.round(top * 2.5)} cm · Piloto ${B.die ? 'puesto' : 'sin poner'}`;
}

// ---------- Colocar y quitar ----------
const buildRay = new THREE.Raycaster();
const groundPlane = new THREE.Plane(Y_AXIS, -TABLE.top);
function rayFrom(e) {
  const rect = canvas.getBoundingClientRect();
  buildRay.setFromCamera(new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1), camera);
}
function pickBuilt(e) {
  rayFrom(e);
  const list = built();
  const hit = buildRay.intersectObjects(list.map((t) => t.mesh), false)[0];
  return hit ? list.find((t) => t.mesh === hit.object) : null;
}

function computePlacement(e) {
  rayFrom(e);
  const isDie = B.tool === 'die';
  const others = built().filter((t) => !(isDie && t === B.die));
  const hit = buildRay.intersectObjects(others.map((t) => t.mesh), false)[0];
  const groundPt = buildRay.ray.intersectPlane(groundPlane, new THREE.Vector3());
  if (!hit && !groundPt) return null;
  const q = isDie ? new THREE.Quaternion() : pieceQuat(B.turn, B.pose);
  const he = isDie ? new THREE.Vector3(DIE / 2, DIE / 2, DIE / 2) : halfExtents(q);
  const step = e.shiftKey ? 0.1 : 0.5;
  const snap = (v) => Math.round(v / step) * step;
  // Se apoya sobre lo más alto que tenga debajo, como si lo soltaras desde arriba
  const boxes = others.map(boxOf);
  const supportAt = (x, z) => {
    let top = TABLE.top, sup = [];
    for (const b of boxes) {
      if (!(x + he.x - 0.03 > b.min.x && x - he.x + 0.03 < b.max.x && z + he.z - 0.03 > b.min.z && z - he.z + 0.03 < b.max.z)) continue;
      if (b.max.y > top + 0.02) { top = b.max.y; sup = [b]; } else if (Math.abs(b.max.y - top) <= 0.02) sup.push(b);
    }
    return { top, sup };
  };
  let cx, cz, base;
  const n = hit ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : null;
  if (n && n.y > 0.5) {
    // Cara de arriba de un bloque: se pone encima, donde apunta el cursor
    cx = snap(hit.point.x); cz = snap(hit.point.z); base = supportAt(cx, cz).top;
  } else if (n) {
    // Cara lateral: el bloque nuevo se pone pegado a ella
    if (Math.abs(n.x) > Math.abs(n.z)) { cx = hit.point.x + Math.sign(n.x) * he.x; cz = snap(hit.point.z); }
    else { cz = hit.point.z + Math.sign(n.z) * he.z; cx = snap(hit.point.x); }
    base = supportAt(cx, cz).top;
  } else {
    // El cursor no toca ningún bloque (mesa o un hueco): se prueba cada altura, de arriba abajo,
    // y se elige la primera donde el bloque quedaría apoyado justo bajo el cursor.
    // Así se puede poner un bloque de puente sobre el hueco entre otros dos.
    const tops = [...new Set(boxes.map((b) => +b.max.y.toFixed(2)))].sort((a, b) => b - a);
    for (const h of [...tops, TABLE.top]) {
      const p = buildRay.ray.intersectPlane(new THREE.Plane(Y_AXIS, -h), new THREE.Vector3());
      if (!p) continue;
      const x = snap(p.x), z = snap(p.z), info = supportAt(x, z);
      if (Math.abs(info.top - h) > 0.03) continue;
      if (h > TABLE.top + 0.01) {
        const r = new THREE.Box3();
        for (const b of info.sup) r.union(b);
        if (p.x < r.min.x - 0.05 || p.x > r.max.x + 0.05 || p.z < r.min.z - 0.05 || p.z > r.max.z + 0.05) continue;
      }
      cx = x; cz = z; base = info.top;
      break;
    }
    if (cx === undefined) { cx = snap(groundPt.x); cz = snap(groundPt.z); base = supportAt(cx, cz).top; }
  }
  const pos = new THREE.Vector3(cx, base + he.y + 0.004, cz);
  let why = '';
  if (Math.abs(cx) + he.x > PLATE + 1e-6 || Math.abs(cz) + he.z > PLATE + 1e-6) why = 'Fuera de la zona de construcción';
  else if (pos.y + he.y > MAX_HEIGHT) why = 'Demasiado alto: el máximo son 40 cm';
  else if (!isDie && B.blocks.length >= MAX_BLOCKS) why = `Máximo ${MAX_BLOCKS} bloques`;
  else if (isDie && base < TABLE.top + 0.5) why = 'El piloto tiene que ir encima de un bloque';
  return { pos, q, ok: !why, why };
}

function hoverBuild(e) {
  B.last = { clientX: e.clientX, clientY: e.clientY, shiftKey: e.shiftKey };
  ghost.visible = ghostDie.visible = ghostErase.visible = false;
  if (B.tool === 'erase') {
    const t = pickBuilt(e);
    if (t) { ghostErase.geometry = t.mesh.geometry; ghostErase.position.copy(t.mesh.position); ghostErase.quaternion.copy(t.mesh.quaternion); ghostErase.visible = true; }
    return;
  }
  const pl = computePlacement(e);
  if (!pl) return;
  const g = B.tool === 'die' ? ghostDie : ghost;
  g.position.copy(pl.pos); g.quaternion.copy(pl.q);
  ghostMat.color.set(pl.ok ? 0x7ee08a : 0xff6b5b);
  g.visible = true;
}

function clickBuild(e) {
  ensureAudio();
  if (B.tool === 'erase') {
    const t = pickBuilt(e);
    if (!t) return;
    pushUndo();
    removeThing(t);
    B.blocks = B.blocks.filter((b) => b !== t); B.extra = B.extra.filter((b) => b !== t);
    if (t === B.die) B.die = null;
    wakeBuilt(); knock(2, 0.8, 0.8); updateCount(); hoverBuild(e);
    return;
  }
  const pl = computePlacement(e);
  if (!pl) return;
  if (!pl.ok) { status(pl.why); return; }
  pushUndo();
  if (B.tool === 'die') { if (B.die) removeThing(B.die); B.die = makeDieThing(pl.pos, pl.q, 'red'); }
  else B.blocks.push(makeBuildBlock(pl.pos, pl.q));
  wakeBuilt(); knock(3, 1, 1); updateCount(); status(TOOL_HINT[B.tool]); hoverBuild(e);
}

// ---------- Deshacer, plantillas, prueba de golpe ----------
function snapshot() { return { blocks: B.blocks.map(poseOf), die: B.die ? poseOf(B.die) : null }; }
function pushUndo() { B.undo.push(snapshot()); if (B.undo.length > 80) B.undo.shift(); }
function clearBuilt() { for (const t of built()) removeThing(t); B.blocks = []; B.extra = []; B.die = null; }
function restore(s) {
  clearBuilt();
  for (const b of s.blocks) B.blocks.push(makeBuildBlock(vec(b.p), quat(b.q)));
  if (s.die) B.die = makeDieThing(vec(s.die.p), quat(s.die.q), 'red');
  updateCount();
}
function undo() {
  const s = B.undo.pop();
  if (!s) { status('No hay nada que deshacer.'); return; }
  restore(s); status('Deshecho.');
}

function loadTemplate(key) {
  pushUndo(); clearBuilt();
  const d = DESIGNS[key];
  B.editingId = d && d.custom ? d.id : null;
  $('b-name').value = d && d.custom ? d.name : 'Mi robot';
  $('b-delete').hidden = !B.editingId;
  if (d) {
    const m = d.make(), lift = new THREE.Vector3(0, 0.003, 0);
    for (const piece of m.blocks) B.blocks.push(makeBuildBlock(vec(piece.p).add(lift), piece.q ? quat(piece.q) : Q_ORIENT[piece.o].clone()));
    B.die = makeDieThing(vec(m.die).add(lift), m.dieQ ? quat(m.dieQ) : new THREE.Quaternion(), 'red');
  }
  updateCount();
  status(d ? `Cargado: ${d.name}. Cámbialo como quieras.` : 'Mesa vacía. Empieza por la base.');
}

function testShot() {
  if (!B.blocks.length) { status('Primero pon algunos bloques.'); return; }
  pushUndo();
  const u = unionBox(B.die ? [...B.blocks, B.die] : B.blocks);
  const target = new THREE.Vector3((u.min.x + u.max.x) / 2, (u.min.y + u.max.y) / 2 + 0.6, (u.min.z + u.max.z) / 2 + rand(-0.8, 0.8));
  const from = new THREE.Vector3(target.x + 18, target.y + 4, target.z);
  const T = 0.5;
  const v = new THREE.Vector3().subVectors(target, from).divideScalar(T);
  v.y -= 0.5 * GRAVITY * T;
  const s = makeBlock(from, new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), v.clone().normalize()), MAT.wood, 'shot', SHOT_MASS);
  s.body.velocity.set(v.x, v.y, v.z);
  B.extra.push(s);
  wakeBuilt(); whoosh(0.7);
  status('¿Aguantó? Pulsa Deshacer para dejarlo como estaba.');
}

// ---------- Guardar ----------
function builtGroup() {
  const boxes = new Map();
  const box = (t) => boxes.get(t) || boxes.set(t, boxOf(t).expandByScalar(0.06)).get(t);
  const group = [B.die], queue = [B.die], rest = new Set(B.blocks);
  while (queue.length) {
    const a = queue.pop();
    for (const b of [...rest]) if (box(a).intersectsBox(box(b))) { rest.delete(b); group.push(b); queue.push(b); }
  }
  return group;
}

function stabilityTest(entry) {
  const w = new CANNON.World({ gravity: new CANNON.Vec3(0, GRAVITY, 0) });
  w.broadphase = new CANNON.SAPBroadphase(w);
  w.solver.iterations = 20; w.solver.tolerance = 1e-5; w.allowSleep = false;
  for (const cm of world.contactmaterials) w.addContactMaterial(cm);
  const table = new CANNON.Body({ mass: 0, material: PM.table });
  table.addShape(new CANNON.Box(new CANNON.Vec3(20, 0.6, 20)));
  table.position.set(0, -0.6, 0);
  w.addBody(table);
  const add = (pose, shape, mass, material) => {
    const b = new CANNON.Body({ mass, material, linearDamping: 0.04, angularDamping: 0.12 });
    b.addShape(shape);
    b.position.set(pose.p[0], pose.p[1] + 0.002, pose.p[2]);
    b.quaternion.set(...pose.q);
    w.addBody(b);
    return b;
  };
  const blocks = entry.blocks.map((p) => add(p, BLOCK_SHAPE, 1, PM.wood));
  const die = add(entry.die, new CANNON.Box(new CANNON.Vec3(DIE / 2, DIE / 2, DIE / 2)), 0.35, PM.die);
  for (let i = 0; i < 360; i++) w.step(FIXED_DT);
  const drop = entry.die.p[1] - die.position.y;
  const moved = Math.max(...blocks.map((b, i) => Math.hypot(b.position.x - entry.blocks[i].p[0], b.position.y - entry.blocks[i].p[1], b.position.z - entry.blocks[i].p[2])));
  return drop < 0.3 && moved < 0.8;
}

function saveDesign() {
  if (!B.die) { status('Falta el piloto: usa la herramienta Piloto y ponlo encima de un bloque.'); return; }
  const parts = [...B.blocks, B.die];
  if (parts.some((t) => t.body.velocity.lengthSquared() > 0.02 || t.body.angularVelocity.lengthSquared() > 0.05)) { status('Espera a que el robot se quede quieto.'); return; }
  if (B.die.body.position.y < TABLE.top + 0.9) { status('El piloto está en la mesa. Ponlo encima de un bloque.'); return; }
  const group = builtGroup(), blocks = group.filter((t) => t !== B.die);
  if (blocks.length < 2) { status('Tu robot necesita al menos 2 bloques unidos al piloto.'); return; }
  if (!B.editingId && CUSTOMS.length >= MAX_SAVED) { status(`Ya tienes ${MAX_SAVED} robots guardados. Borra alguno para guardar otro.`); return; }
  // Se centra el robot para que aparezca bien colocado en la partida
  const u = unionBox(group), cx = (u.min.x + u.max.x) / 2, cz = (u.min.z + u.max.z) / 2;
  const rel = (t) => {
    const o = poseOf(t);
    o.p = [o.p[0] - cx, o.p[1] - TABLE.top, o.p[2] - cz].map((v) => +v.toFixed(4));
    o.q = o.q.map((v) => +v.toFixed(5));
    return o;
  };
  const name = ($('b-name').value.trim() || 'Mi robot').slice(0, 16);
  const id = B.editingId || Date.now().toString(36);
  const entry = { id, name, blocks: blocks.map(rel), die: rel(B.die) };
  if (!stabilityTest(entry)) {
    status('No se guardó: en la prueba de física tu robot no aguanta de pie (se mueven piezas o cae el piloto). Refuérzalo y vuelve a intentarlo.');
    knock(2, 0.5, 0.6);
    return;
  }
  const i = CUSTOMS.findIndex((d) => d.id === id);
  if (i >= 0) CUSTOMS[i] = entry; else CUSTOMS.push(entry);
  const stored = persistCustoms();
  registerCustoms(); fillStartSelect();
  B.editingId = id; B.savedKey = 'c_' + id; $('b-delete').hidden = false; $('b-start').value = 'c_' + id;
  const skipped = B.blocks.length - blocks.length;
  const where = B.returnTo === 'picker' ? 'Pulsa «Volver a elegir» y ya estará elegido.' : 'Aparecerá al elegir robots antes de una partida.';
  status((stored ? `Guardado "${name}". ${where}` : `Guardado "${name}" solo mientras esta página siga abierta: este navegador no permite guardar datos.`)
    + (skipped ? ` ${skipped} bloque${skipped > 1 ? 's' : ''} suelto${skipped > 1 ? 's' : ''} no se ${skipped > 1 ? 'guardaron' : 'guardó'}.` : ''));
  tune([523, 784], 'triangle', 0.12, 0.12);
}

function deleteSaved() {
  if (!B.editingId) return;
  if (performance.now() - B.confirmDelete > 3000) {
    B.confirmDelete = performance.now();
    $('b-delete').textContent = '¿Seguro? Pulsa otra vez';
    setTimeout(() => { $('b-delete').textContent = 'Borrar guardado'; }, 3000);
    return;
  }
  const d = CUSTOMS.find((c) => c.id === B.editingId);
  CUSTOMS = CUSTOMS.filter((c) => c.id !== B.editingId);
  persistCustoms(); registerCustoms(); fillStartSelect();
  B.editingId = null; $('b-delete').hidden = true; $('b-delete').textContent = 'Borrar guardado';
  status(`Borrado "${d ? d.name : ''}". Lo que ves en la mesa sigue aquí hasta que salgas.`);
}

// ---------- Entrar y salir del taller ----------
function fillStartSelect() {
  const opts = [['empty', 'Mesa vacía'], ...Object.keys(DESIGNS).filter((k) => !DESIGNS[k].custom).map((k) => [k, DESIGNS[k].name]),
    ...CUSTOMS.map((d) => ['c_' + d.id, `Mío: ${d.name}`])];
  $('b-start').innerHTML = opts.map(([v, t]) => `<option value="${v}">${esc(t)}</option>`).join('');
}
function setTool(tool) {
  B.tool = tool;
  for (const b of document.querySelectorAll('#builder [data-tool]')) b.setAttribute('aria-pressed', String(b.dataset.tool === tool));
  ghost.visible = ghostDie.visible = ghostErase.visible = false;
  status(TOOL_HINT[tool]);
  if (B.last) hoverBuild(B.last);
}
function turnPiece() { B.turn = 1 - B.turn; if (B.last) hoverBuild(B.last); }
function nextPose() {
  B.pose = (B.pose + 1) % 3;
  $('b-pose').textContent = `Postura: ${POSES[B.pose]} (F)`;
  if (B.last) hoverBuild(B.last);
}

// returnTo = 'picker': se entra desde la pantalla de elegir robots (o la revancha) y al salir se vuelve ahí
function openBuilder(returnTo = null) {
  B.returnTo = returnTo; B.savedKey = null;
  B.pickerState = returnTo === 'picker'
    ? { team: picker.team, slots: [...picker.slots], title: $('picker-title').textContent, back: $('picker-back').textContent } : null;
  if (G.net) NET.stage = 'build';
  for (const id of ['menu', 'picker', 'result']) $(id).hidden = true;
  clearWorld();
  G.mode = 'build'; G.active = null;
  document.body.classList.add('building');
  $('builder').hidden = false;
  buildDeco.visible = true; fan.visible = false;
  B.blocks = []; B.extra = []; B.die = null; B.undo = []; B.editingId = null;
  $('b-name').value = 'Mi robot'; $('b-delete').hidden = true;
  $('b-exit').textContent = returnTo === 'picker' ? 'Volver a elegir' : 'Salir';
  fillStartSelect(); setTool('block'); updateCount();
  status('Empieza por la base: haz clic en la mesa. El frente del robot es la flecha amarilla.');
}
function exitBuilder() {
  clearBuilt();
  for (const g of [ghost, ghostDie, ghostErase]) g.visible = false;
  buildDeco.visible = false; fan.visible = true;
  $('builder').hidden = true;
  document.body.classList.remove('building');
  G.mode = 'menu';
  setupMatch(); renderTeams();
  if (B.returnTo === 'picker') backToPicker();
  else $('menu').hidden = false;
}
// Vuelve a elegir robots con lo que ya tenías elegido y el robot que acabas de guardar ya puesto el primero
function backToPicker() {
  const st = B.pickerState;
  if (G.net && NET.peerGone) { netToLobby(NET.peerGone); return; }
  if (!THUMBS) THUMBS = makeThumbs();
  let slots = st.slots.filter((k) => DESIGNS[k]);
  if (B.savedKey && DESIGNS[B.savedKey]) slots = [B.savedKey, ...slots].slice(0, 2);
  if (G.net) NET.stage = 'pick';
  $('picker').hidden = false;
  pickerFor(st.team, slots);
  $('picker-title').textContent = st.title; $('picker-back').textContent = st.back;
}

for (const b of document.querySelectorAll('#builder [data-tool]')) b.addEventListener('click', () => setTool(b.dataset.tool));
$('b-turn').addEventListener('click', turnPiece);
$('b-pose').addEventListener('click', nextPose);
$('b-undo').addEventListener('click', undo);
$('b-test').addEventListener('click', testShot);
$('b-load').addEventListener('click', () => loadTemplate($('b-start').value));
$('b-delete').addEventListener('click', deleteSaved);
$('b-save').addEventListener('click', saveDesign);
$('b-exit').addEventListener('click', exitBuilder);
$('b-zoom-in').addEventListener('click', () => { B.camDist = clamp(B.camDist - 4, 10, 50); });
$('b-zoom-out').addEventListener('click', () => { B.camDist = clamp(B.camDist + 4, 10, 50); });
$('btn-build').addEventListener('click', () => { ensureAudio(); openBuilder(); });
