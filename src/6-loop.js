
// ---------- Bucle, cámara y controles ----------
const CHARGE_TIME = 1.6;
const FIXED_DT = 1 / 120;

function onAnyCollide(e) {
  const v = Math.abs(e.contact.getImpactVelocityAlongNormal());
  if (v < 1.8) return;
  const t = this.userData, now = performance.now();
  if (!t || now - (t.lastSound || 0) < 70) return;
  t.lastSound = now;
  if (G.net && NET.role === 'host' && v > 3) netEvent({ e: 'k', v: +v.toFixed(1), d: t.kind === 'die' ? 1 : t.kind === 'prop' ? 2 : 0 });
  if (t.kind === 'die') knock(v * 0.7, 1.9, 1.6);
  else if (t.kind === 'prop') knock(v * 0.8, 0.6, 0.7);
  else knock(v, 1, 1);
}

const windForce = new CANNON.Vec3(), X_AXIS = new THREE.Vector3(1, 0, 0), tmpV = new THREE.Vector3(), tmpQ = new THREE.Quaternion();
function applyWind() {
  applyWalkStep(FIXED_DT);
  if (G.remote) applyWalkStep(FIXED_DT, G.remote);
  if (G.mode === 'war') { for (const s of G.shots) if (!s.hit) guideShot(s.thing.body); return; }
  if (G.mode !== 'flying' || !G.shot || G.shotHit) return;
  guideShot(G.shot.body);
}
function guideShot(b) {
  const m = b.mass;
  windForce.set(G.wind.x * m, 0, G.wind.z * m);
  b.applyForce(windForce);
  // Vuela como un dardo: la punta siempre mira hacia donde va, para pegar justo donde apuntaste
  const v = b.velocity, len = v.length();
  if (len > 0.5) {
    tmpQ.setFromUnitVectors(X_AXIS, tmpV.set(v.x / len, v.y / len, v.z / len));
    b.quaternion.set(tmpQ.x, tmpQ.y, tmpQ.z, tmpQ.w);
    b.angularVelocity.setZero();
  }
}

// ---------- Mira: objetivo, trayectoria completa y aviso de obstáculos ----------
const PATH_N = 90;
const pathDots = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ color: 0xf2b134, size: 0.16, transparent: true, opacity: 0.22, depthWrite: false }));
pathDots.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(PATH_N * 3), 3));
pathDots.frustumCulled = false;
scene.add(pathDots);
const retMat = new THREE.MeshBasicMaterial({ color: 0xf2b134, transparent: true, depthTest: false, side: THREE.DoubleSide });
const reticle = new THREE.Group();
reticle.add(new THREE.Mesh(new THREE.RingGeometry(0.42, 0.58, 40), retMat), new THREE.Mesh(new THREE.CircleGeometry(0.09, 16), retMat));
for (const a of [0, 1, 2, 3]) {
  const tick = new THREE.Mesh(new THREE.PlaneGeometry(0.07, 0.28), retMat);
  tick.position.set(Math.cos(a * Math.PI / 2) * 0.78, Math.sin(a * Math.PI / 2) * 0.78, 0);
  tick.rotation.z = a * Math.PI / 2 + Math.PI / 2;
  reticle.add(tick);
}
reticle.traverse((o) => { o.renderOrder = 20; });
const blockMark = new THREE.Mesh(new THREE.RingGeometry(0.22, 0.4, 24), new THREE.MeshBasicMaterial({ color: 0xff5a4a, transparent: true, depthTest: false, side: THREE.DoubleSide }));
blockMark.renderOrder = 21;
// Flecha en el suelo: hacia dónde mira tu robot (W lo lleva hacia ahí; la cámara ya no gira con él)
const facingArrow = new THREE.Mesh(
  new THREE.ShapeGeometry(new THREE.Shape([new THREE.Vector2(1.1, 0), new THREE.Vector2(-0.6, 0.75), new THREE.Vector2(-0.2, 0), new THREE.Vector2(-0.6, -0.75)])).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0xf2b134, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }));
scene.add(reticle, blockMark, facingArrow);
const aimRay = new THREE.Raycaster(), pathRay = new THREE.Raycaster();
const CENTER = new THREE.Vector2(0, 0);

function sceneTargets(exclude) {
  const list = things.filter((t) => !exclude(t)).map((t) => t.mesh);
  const top = scene.getObjectByName('tableTop');
  if (top) list.push(top);
  return list;
}
function toNdc(e) {
  const rect = canvas.getBoundingClientRect();
  return new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
}
const hitNormal = (hit) => (hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : new THREE.Vector3(0, 1, 0));
// Lo que hay en ese punto de la pantalla. Si no toca ninguna superficie, se apunta al aire en esa dirección.
function pickAim(ndc) {
  aimRay.setFromCamera(ndc, camera);
  const hit = aimRay.intersectObjects(sceneTargets((t) => t.robot && t.robot.team === G.team), true)[0];
  if (!hit) return { air: aimRay.ray.at(400, new THREE.Vector3()) };
  return { p: hit.point.clone(), n: hitNormal(hit) };
}
function setAim(ndc) {
  if (G.locked) return;
  const h = pickAim(ndc);
  G.target = h.p || null; G.targetN = h.n || null; G.air = h.air || null;
}
const hoverAim = (e) => setAim(toNdc(e));

function placeReticle(p, nrm) {
  reticle.visible = true;
  reticle.position.copy(p).addScaledVector(nrm, 0.04);
  reticle.lookAt(reticle.position.clone().add(nrm));
}
function updatePreview() {
  pathDots.visible = reticle.visible = blockMark.visible = false;
  G.blocked = false;
  if ((G.mode !== 'aim' && G.mode !== 'war') || !G.active) return;
  const arr = pathDots.geometry.attributes.position.array, a = shotAccel();
  let count = 0;
  if (isCpuTurn()) {
    // Arco de la CPU mientras carga el tiro
    if (!G.charging) return;
    const p = spawnPoint(G.active), v = aimDir().multiplyScalar(shotSpeed(G.power));
    for (let i = 1; i <= 400 && count < PATH_N; i++) {
      v.addScaledVector(a, FIXED_DT); p.addScaledVector(v, FIXED_DT);
      if (i % 4 === 0) { arr[count * 3] = p.x; arr[count * 3 + 1] = p.y; arr[count * 3 + 2] = p.z; count++; }
      if (p.y < TABLE.top) break;
    }
  } else {
    if (!G.aim) return;
    // Recorrido completo, paso a paso igual que el motor de física.
    // Tiro bombeado: avisa si algo se cruza antes del objetivo. Tiro directo: marca dónde cae.
    const { from, n, direct } = G.aim, v = G.aim.v.clone(), p = from.clone(), prev = from.clone();
    const stride = Math.max(1, Math.ceil(n / PATH_N));
    const meshes = sceneTargets((t) => t.robot === G.active);
    let land = null;
    for (let i = 1; i <= n; i++) {
      v.addScaledVector(a, FIXED_DT); p.addScaledVector(v, FIXED_DT);
      const last = i === n || p.y < FLOOR_Y;
      if (i % stride && !last) continue;
      if (!land) {
        const seg = p.clone().sub(prev), len = seg.length();
        pathRay.set(prev, seg.divideScalar(len || 1)); pathRay.far = len;
        const hit = len > 1e-4 ? pathRay.intersectObjects(meshes, true)[0] : null;
        if (hit && (direct || hit.point.distanceTo(G.target) > 1.2)) land = hit;
      }
      const dot = land && direct ? land.point : p;
      if (count < PATH_N) { arr[count * 3] = dot.x; arr[count * 3 + 1] = dot.y; arr[count * 3 + 2] = dot.z; count++; }
      prev.copy(p);
      if (last || (land && direct)) break;
    }
    if (direct) { if (land) placeReticle(land.point, hitNormal(land)); }
    else {
      placeReticle(G.target, G.targetN || up(1));
      if (land) { G.blocked = true; blockMark.position.copy(land.point); blockMark.lookAt(camera.position); blockMark.visible = true; }
    }
    retMat.color.set(G.blocked ? 0xff9a3c : direct ? 0xffe9a8 : 0xf2b134);
  }
  pathDots.material.color.set(G.blocked ? 0xff9a3c : 0xf2b134);
  pathDots.geometry.setDrawRange(0, count);
  pathDots.geometry.attributes.position.needsUpdate = true;
  pathDots.visible = count > 0;
}
// Dónde se ve el piloto (el invitado lo suaviza entre paquetes de red)
const pilotPos = (r) => (G.net && NET.role === 'guest' ? r.die.mesh.position : r.die.body.position);
function updateFacing() {
  const r = G.active;
  facingArrow.visible = !!r && canControl() && !G.overview;
  if (!facingArrow.visible) return;
  const d = pilotPos(r), yaw = r.yaw || 0;
  facingArrow.position.set(d.x + Math.cos(yaw) * 3.8, Math.max(TABLE.top, d.y - r.dieStartY) + 0.06, d.z - Math.sin(yaw) * 3.8);
  facingArrow.rotation.set(0, yaw, 0);
}

const camPos = camera.position.clone(), camLook = new THREE.Vector3(0, 2, 0);
let orbit = 0.6, camKey = '';
const up = (y) => new THREE.Vector3(0, y, 0);
const viewDir = (yaw, pitch) => new THREE.Vector3(Math.cos(pitch) * Math.cos(yaw), Math.sin(pitch), Math.cos(pitch) * Math.sin(yaw));
function updateCamera(dt) {
  const want = new THREE.Vector3(), look = new THREE.Vector3();
  let free = false;   // cámara del jugador: solo la gira el ratón
  if (G.mode === 'build') {
    const top = B.blocks.length ? unionBox(B.blocks).max.y : 0, fy = clamp(top * 0.45, 1.5, 7);
    want.set(Math.cos(B.camYaw) * Math.cos(B.camPitch) * B.camDist, fy + Math.sin(B.camPitch) * B.camDist, Math.sin(B.camYaw) * Math.cos(B.camPitch) * B.camDist);
    look.set(0, fy, 0);
  } else if (G.mode === 'menu' || G.mode === 'over') {
    orbit += dt * 0.07;
    want.set(Math.cos(orbit) * TABLE.hx * 1.45, 40, Math.sin(orbit) * TABLE.hz * 1.9); look.set(0, 2, 0);
  } else if (G.overview) {
    want.set(0, TABLE.hx * 1.55, TABLE.hz * 2.1); look.set(0, 0, 2);
  } else if ((G.mode === 'aim' || G.mode === 'war') && G.active) {
    // Detrás del robot y siguiéndolo, pero sin girar con él: el ángulo lo decide el ratón
    // (en el turno de la CPU, mira hacia donde apunta ella)
    const cpu = isCpuTurn(), yaw = cpu ? G.yaw : G.camYaw, pitch = cpu ? CAM_PITCH0 : G.camPitch;
    const p = pilotPos(G.active);
    // Al mirar hacia arriba la cámara no baja: solo levanta la vista
    const back = viewDir(yaw, Math.min(pitch, 0)), side = new THREE.Vector3(-Math.sin(yaw), 0, Math.cos(yaw));
    want.copy(p).add(up(3.6)).addScaledVector(back, -G.camDist).addScaledVector(side, G.camDist * 0.22);
    look.copy(want).addScaledVector(viewDir(yaw, pitch), 30);
    free = !cpu;
  } else if (G.mode === 'flying' && G.shot) {
    const p = G.shot.body.position, v = G.shot.body.velocity;
    const vh = new THREE.Vector3(v.x, 0, v.z);
    if (vh.lengthSq() < 1e-4) vh.set(Math.cos(G.yaw), 0, Math.sin(G.yaw));
    vh.normalize();
    want.copy(p).addScaledVector(vh, -14).add(up(5)).addScaledVector(new THREE.Vector3(-vh.z, 0, vh.x), 4);
    look.copy(p).addScaledVector(vh, 5);
  } else {
    const dh = new THREE.Vector3(Math.cos(G.yaw), 0, Math.sin(G.yaw));
    want.copy(G.impact).addScaledVector(dh, -18).add(up(9)).addScaledVector(new THREE.Vector3(-dh.z, 0, dh.x), 6);
    want.y = Math.max(want.y, 7);
    look.copy(G.impact); look.y = clamp(look.y, 1.5, 12);
  }
  // En el taller, el robot se dibuja corrido para que el panel no lo tape
  const vw = window.innerWidth, vh = window.innerHeight;
  if (G.mode === 'build') camera.setViewOffset(vw, vh, vw > 700 ? -vw * 0.16 : 0, vw > 700 ? -vh * 0.03 : -vh * 0.16, vw, vh);
  else if (camera.view && camera.view.enabled) camera.clearViewOffset();
  // Al cambiar de modo o de robot la cámara viaja despacio; después sigue al ratón al momento
  const key = `${G.mode}|${G.overview}|${robots.indexOf(G.active)}`;
  if (key !== camKey) { camKey = key; G.camFollow = 0; }
  G.camFollow = Math.min(1, G.camFollow + dt * 1.6);
  const k = 1 - Math.exp(-dt * (free ? 3 + 22 * G.camFollow : G.mode === 'flying' ? 5 : 3));
  camPos.lerp(want, k);
  if (free) {
    // La mira es el centro exacto de la pantalla: la vista apunta justo hacia donde dice el ratón
    look.copy(camPos).addScaledVector(viewDir(G.camYaw, G.camPitch), 30);
    if (G.camFollow >= 1) camLook.copy(look); else camLook.lerp(look, 1 - Math.exp(-dt * (3 + 57 * G.camFollow)));
  } else camLook.lerp(look, k);
  camera.position.copy(camPos);
  if (G.shake > 0) camera.position.add(new THREE.Vector3(rand(-1, 1), rand(-0.6, 0.6), rand(-1, 1)).multiplyScalar(G.shake));
  const overTable = Math.abs(camera.position.x) < TABLE.hx + 1 && Math.abs(camera.position.z) < TABLE.hz + 1;
  if (overTable && camera.position.y < TABLE.top + 1.5) camera.position.y = TABLE.top + 1.5;
  camera.lookAt(camLook);
}

// ---------- Entrada ----------
const keys = new Set();
const KEYMAP = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down', KeyW: 'mf', KeyS: 'mb', KeyA: 'ml', KeyD: 'mr' };
const TOUCH_WALK = { up: 'mf', down: 'mb', left: 'ml', right: 'mr' };
let touchWalk = false;
const canControl = () => (G.mode === 'aim' || G.mode === 'war') && !isCpuTurn();
const inMatch = () => G.mode === 'aim' || G.mode === 'war' || G.mode === 'flying' || G.mode === 'settle';
function toggleView() {
  G.overview = !G.overview;
  if (G.overview) releaseMouse();   // en la vista general se apunta con el cursor
  $('btn-view').textContent = G.overview ? 'Vista del robot (V)' : 'Vista general (V)';
}
function toggleSound() { audio.on = !audio.on; $('btn-sound').textContent = `Sonido: ${audio.on ? 'sí' : 'no'}`; }

// Ratón capturado (pointer lock): moverlo gira la cámara y se apunta con la mira del centro.
// En pantallas táctiles, o si el navegador no lo deja, se sigue apuntando con el cursor.
const canLock = 'requestPointerLock' in canvas && !matchMedia('(pointer: coarse)').matches;
let lockWorks = null;   // null: aún no se sabe · true: ya funcionó · false: este navegador no deja capturarlo
const mouseLocked = () => document.pointerLockElement === canvas;
const lockHint = () => canLock && lockWorks !== false && !mouseLocked();
function lockMouse() {
  try { const p = canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch { /* se comprueba abajo */ }
  // Si nunca ha funcionado y no engancha, se deja de intentar: se apunta y dispara con el cursor
  setTimeout(() => { if (!mouseLocked() && lockWorks !== true) lockWorks = false; }, 800);
}
function releaseMouse() { if (mouseLocked()) document.exitPointerLock(); }
document.addEventListener('pointerlockchange', () => { if (mouseLocked()) lockWorks = true; else G.firing = false; });
document.addEventListener('mousemove', (e) => {
  if (!mouseLocked() || !canControl() || G.overview) return;
  G.camYaw += clamp(e.movementX, -150, 150) * MOUSE_SENS;
  G.camPitch = clamp(G.camPitch - clamp(e.movementY, -150, 150) * MOUSE_SENS, PITCH_MIN, PITCH_MAX);
});

addEventListener('keydown', (e) => {
  if (e.target && e.target.closest && e.target.closest('input, select, textarea')) return;
  if (G.mode === 'build') {
    const act = { Digit1: () => setTool('block'), Digit2: () => setTool('die'), Digit3: () => setTool('erase'), KeyR: turnPiece, KeyF: nextPose, KeyZ: undo, KeyG: testShot }[e.code];
    if (act) { e.preventDefault(); act(); }
    return;
  }
  if (e.code in KEYMAP) { keys.add(KEYMAP[e.code]); e.preventDefault(); }
  else if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); if (!e.repeat) tryFire(); }
  else if (e.code === 'Escape') { G.locked = false; }
  else if (e.code === 'Tab') { e.preventDefault(); switchRobot(); }
  else if (e.code === 'KeyV') toggleView();
  else if (e.code === 'KeyM') toggleSound();
});
addEventListener('keyup', (e) => {
  if (e.code in KEYMAP) keys.delete(KEYMAP[e.code]);
});
addEventListener('blur', () => { keys.clear(); G.firing = false; });

let drag = null;
const raycaster = new THREE.Raycaster();
// ¿Hay otro de tus robots (no el que manejas) en ese punto de la pantalla?
function ownRobotAt(ndc) {
  raycaster.setFromCamera(ndc, camera);
  const mine = robots.filter((r) => r.team === G.team && r.alive && r !== G.active);
  const hit = raycaster.intersectObjects(mine.flatMap((r) => [r.die.mesh, ...r.blocks.map((b) => b.mesh)]), false)[0];
  return hit ? mine.find((r) => r.die.mesh === hit.object || r.blocks.some((b) => b.mesh === hit.object)) : null;
}
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointerdown', (e) => {
  ensureAudio();
  drag = { x: e.clientX, y: e.clientY, id: e.pointerId, moved: 0, button: e.button, touch: e.pointerType === 'touch' };
  if (!mouseLocked()) try { canvas.setPointerCapture(e.pointerId); } catch { /* nada */ }
  if (G.mode === 'build') return;
  // Primer clic en la partida: el ratón pasa a mover la cámara (Esc lo suelta). Ese clic no dispara.
  if (e.pointerType === 'mouse' && e.button === 0 && lockHint() && inMatch() && !G.overview) { drag.lockClick = true; lockMouse(); return; }
  // En Guerra total, mantener el botón izquierdo dispara una ráfaga cada vez que el robot recarga
  if (G.mode === 'war' && e.button === 0 && !drag.touch && canControl()) {
    const at = mouseLocked() ? CENTER : toNdc(e);
    if (!mouseLocked()) setAim(at);
    if (!ownRobotAt(at)) G.firing = true;
  }
});
canvas.addEventListener('pointermove', (e) => {
  if (mouseLocked()) return;   // con el ratón capturado, la cámara la mueve 'mousemove'
  const d = drag && drag.id === e.pointerId ? drag : null;
  let dx = 0, dy = 0;
  if (d) { dx = e.clientX - d.x; dy = e.clientY - d.y; d.x = e.clientX; d.y = e.clientY; d.moved += Math.abs(dx) + Math.abs(dy); }
  if (G.mode === 'build') {
    if (d && d.moved > 6) { B.camYaw += dx * 0.006; B.camPitch = clamp(B.camPitch + dy * 0.005, 0.12, 1.4); }
    if (!drag || drag.moved < 6) hoverBuild(e);
    return;
  }
  // Clic derecho (o un dedo) arrastrando: también gira la cámara
  const turning = d && (d.button === 2 || d.touch) && d.moved > 6;
  if (turning && canControl() && !G.overview) { G.camYaw += dx * 0.006; G.camPitch = clamp(G.camPitch - dy * 0.004, PITCH_MIN, PITCH_MAX); }
  if (canControl() && !turning) hoverAim(e);
});
const endDrag = () => { drag = null; G.firing = false; };
canvas.addEventListener('pointerup', (e) => {
  const d = drag, wasClick = d && d.moved < 6;
  endDrag();
  if (G.mode === 'build') { if (wasClick) clickBuild(e); return; }
  if (!d || d.lockClick || !canControl()) return;
  if (d.button === 2) return;
  if (!wasClick && d.touch) return;
  const at = mouseLocked() ? CENTER : toNdc(e);
  // Clic sobre otro de tus robots: lo selecciona
  const mine = wasClick && ownRobotAt(at);
  if (mine) { selectRobot(mine); return; }
  // Clic en cualquier otro sitio: dispara ahí (en Guerra total ya disparó al mantener pulsado)
  setAim(at);
  updateAim();
  if (G.mode === 'war' && (!wasClick || !readyToFire(G.active))) return;
  tryFire();
});
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (G.mode === 'build') B.camDist = clamp(B.camDist + e.deltaY * 0.02, 10, 50);
  else if (e.shiftKey) G.arc = clamp(G.arc - e.deltaY * 0.001, 0, 1);
  else G.camDist = clamp(G.camDist + e.deltaY * 0.012, 8, 40);
}, { passive: false });

for (const btn of document.querySelectorAll('#touch [data-key]')) {
  let k = null;
  btn.addEventListener('pointerdown', (e) => { e.preventDefault(); k = touchWalk ? TOUCH_WALK[btn.dataset.key] : btn.dataset.key; keys.add(k); btn.classList.add('held'); });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) btn.addEventListener(ev, () => { if (k) keys.delete(k); k = null; btn.classList.remove('held'); });
}
$('btn-mode').addEventListener('click', () => { touchWalk = !touchWalk; $('btn-mode').textContent = touchWalk ? 'Modo: caminar' : 'Modo: apuntar'; });
$('btn-fire').addEventListener('pointerdown', (e) => { e.preventDefault(); $('btn-fire').classList.add('held'); tryFire(); });
for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) $('btn-fire').addEventListener(ev, () => { $('btn-fire').classList.remove('held'); });
$('btn-view').addEventListener('click', toggleView);
$('btn-switch').addEventListener('click', switchRobot);
$('btn-sound').addEventListener('click', toggleSound);
$('btn-cpu').addEventListener('click', () => { ensureAudio(); startMatch(true); });
$('btn-2p').addEventListener('click', () => { ensureAudio(); startMatch(false); });
$('btn-war').addEventListener('click', () => { ensureAudio(); startMatch(true, true); });

// ---------- Bucle principal ----------
let last = performance.now(), acc = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = clamp((now - last) / 1000, 0, 0.05);
  last = now;
  audio.budget = 4;
  G.timeScale = G.slowmo > 0 ? 0.3 : 1;
  G.slowmo = Math.max(0, G.slowmo - dt);
  G.shake = Math.max(0, G.shake - dt * 2.2);
  const guest = G.net && NET.role === 'guest' && G.mode === 'war';   // en red, el invitado no calcula la física de la partida: la recibe

  if (canControl()) {
    // Las flechas y WASD solo mueven el robot: la cámara no gira con él
    const turn = (keys.has('left') ? 1 : 0) - (keys.has('right') ? 1 : 0);
    if (keys.has('up')) G.arc = clamp(G.arc + dt * 0.5, 0, 1);
    if (keys.has('down')) G.arc = clamp(G.arc - dt * 0.5, 0, 1);
    const fwd = (keys.has('mf') ? 1 : 0) - (keys.has('mb') ? 1 : 0), side = (keys.has('mr') ? 1 : 0) - (keys.has('ml') ? 1 : 0);
    if (guest) NET.input = { fwd, side, turn };
    else if (G.mode === 'war') {
      // Movimiento sin límite para esquivar
      G.walkLeft = WALK_BUDGET; G.moved = false;
      if (G.walkLock > 0) updateWalk(dt, 0, 0); else updateWalk(dt, fwd, side, turn);
      if (!G.walking) endWalk();
    } else updateWalk(dt, fwd, side, turn);
    G.timer -= dt;
    if (G.mode === 'aim' && G.timer <= 0) { toast('¡Se acabó el tiempo!', 1200); G.charging = false; G.power = 0; endTurn(); }
  }
  updateCpu(dt);
  if (guest) netGuestFrame(dt);
  else {
    updateWar(dt);
    acc += dt * G.timeScale;
    let n = 0;
    while (acc >= FIXED_DT && n < 10) { applyWind(); world.step(FIXED_DT); acc -= FIXED_DT; n++; }
    if (n === 10) acc = 0;
    for (const t of things) if (t.body.sleepState !== CANNON.Body.SLEEPING) syncMesh(t);
  }
  if (G.net && NET.role === 'host' && G.mode === 'war') netHostTick(dt);
  if (G.walkGroup) {
    const bob = G.walking ? Math.abs(Math.sin(G.walkPhase)) * 0.22 : 0;
    for (const t of G.walkGroup) { syncMesh(t); t.mesh.position.y += bob; }
  }

  if (G.mode === 'flying' && G.shot) {
    const p = G.shot.body.position;
    if (p.y < TABLE.top - 3 || Math.abs(p.x) > 150 || Math.abs(p.z) > 150) { G.impact.copy(p); G.shotHit = true; G.mode = 'settle'; }
  }
  if (G.mode === 'settle') {
    G.settleT += dt;
    let moving = false;
    for (const t of things) {
      const b = t.body;
      if (b.sleepState === CANNON.Body.SLEEPING || b.position.y < TABLE.top - 2) continue;
      if (b.velocity.lengthSquared() > 0.3 || b.angularVelocity.lengthSquared() > 0.6) { moving = true; break; }
    }
    G.quietT = moving ? 0 : G.quietT + dt;
    checkPilots(false);
    if (G.mode === 'settle' && ((G.quietT > 0.6 && G.settleT > 1.2) || G.settleT > 9)) checkPilots(true);
  }

  for (const r of robots) {
    r.label.position.set(r.die.body.position.x, r.die.body.position.y + 2, r.die.body.position.z);
    r.label.visible = !(r === G.active && (G.mode === 'aim' || G.mode === 'war') && !G.overview);
  }
  updateFan(dt, G.wind.strength);
  updateCamera(dt);
  if (canControl()) {
    // Con el ratón capturado se apunta a lo que haya en el centro de la pantalla (o al aire)
    if (mouseLocked() && !G.overview) { camera.updateMatrixWorld(); setAim(CENTER); }
    updateAim();
  }
  if (!inMatch()) releaseMouse();
  updateFacing();
  updatePreview();
  updateHud();
  renderer.render(scene, camera);
}

setupMatch();
renderTeams();
document.fonts?.ready?.then(renderTeams);
$('btn-cpu').disabled = false;
$('btn-2p').disabled = false;
$('loading').hidden = true;
window.__bbReady = true;
window.__bb = { G, robots, things, world, fire, startMatch, planCpuShot, aimDir, B, camera, clickBuild, hoverBuild, saveDesign, loadTemplate, setTool, openBuilder, THREE, stabilityTest, robotGroup, frame, NET: typeof NET !== "undefined" ? NET : null,
  setAim, updateAim, tryFire, readyToFire, mouseLocked, gameOver, netRematch, netShowResult, CENTER, get lockWorks() { return lockWorks; } };
requestAnimationFrame(frame);
