
// ---------- Guerra total: sin turnos, todos disparan a la vez ----------
const WAR_RELOAD = 2.5;          // recarga de cada robot tuyo (s)
const WAR_CPU_RELOAD = [4.5, 6.5];
const WAR_BURST = 3;             // cada disparo de un jugador es una ráfaga de 3 bloques
const WAR_MAX_SHOTS = 30;        // bloques disparados que se quedan en la mesa

function setWind(s = Math.pow(Math.random(), 0.8)) {
  const a = rand(0, Math.PI * 2);
  G.wind = { angle: a, strength: s, x: Math.cos(a) * s * WIND_MAX, z: Math.sin(a) * s * WIND_MAX };
  fanAngleTarget = a;
}

function startWar() {
  G.mode = 'war'; G.team = G.myTeam; G.shots = []; G.windT = 0; G.walkLock = 0; G.timer = 999;
  setWind(rand(0, 0.4));
  G.active = robots.find((r) => r.team === G.myTeam && r.alive);
  for (const r of robots) { r.cool = r.team === G.myTeam || G.net ? 0 : rand(4, 6); r.burst = 0; }
  aimAtNearestEnemy(); faceCamera();
  G.arc = 0.35; G.target = null; G.air = null; G.locked = false; G.aim = null;
  G.walkLeft = WALK_BUDGET; G.moved = false; G.ai = null;
  const title = G.net && NET.played ? '¡Revancha!' : '¡Guerra total!';
  $('turn-title').textContent = title;
  $('turn-title').style.color = '#ffb08a';
  renderTeams();
  toast(title, 1400, '#ffb08a');
  tune([392, 523, 659], 'square', 0.1, 0.12);
}

function warFire(robot, v, from) {
  if (robot === G.active) endWalk();
  if (G.remote && robot === G.remote.active) endWalk(G.remote);
  if (G.net) netEvent({ e: 'w', v: 0.45 });
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), v.clone().normalize());
  const t = makeBlock(from, q, MAT.wood, 'shot', SHOT_MASS);
  t.body.velocity.set(v.x, v.y, v.z);
  t.body.angularVelocity.set(0, 0, 0);
  t.body.linearDamping = 0;
  t.body.allowSleep = false;
  const s = { thing: t, hit: false, age: 0, team: robot.team };
  t.body.addEventListener('collide', (e) => {
    if (s.hit) return;
    s.hit = true;
    t.body.linearDamping = 0.04; t.body.allowSleep = true;
    const sp = t.body.velocity.length(), other = e.body.userData;
    if (other && other.robot && sp > 14) G.shake = Math.min(0.6, G.shake + sp / 90);
  });
  G.shots.push(s);
  whoosh(robot.team === 'red' ? 0.6 : 0.35);
}

// ---------- Ráfagas: el primer bloque sale ya y los otros dos detrás, por el mismo sitio ----------
// La recarga empieza con el primer disparo. `next` da la velocidad y el punto de salida de cada bloque.
const readyToFire = (r) => !!r && r.alive && (r.cool || 0) <= 0 && !(r.burst > 0);
// Tiempo entre bloques: el anterior tiene que haberse apartado (un bloque mide 3 de largo)
const burstGap = (v) => clamp(3.6 / v.length(), 0.1, 0.4);
// Un poco de dispersión para que la ráfaga no sea una sola línea
function spread(v) {
  return v.clone().applyEuler(new THREE.Euler(rand(-1, 1) * 0.012, rand(-1, 1) * 0.012, rand(-1, 1) * 0.012)).multiplyScalar(rand(0.99, 1.01));
}
function startBurst(robot, next, reload) {
  const s = next();
  if (!s) return false;
  warFire(robot, s.v, s.from);
  Object.assign(robot, { cool: reload, burst: WAR_BURST - 1, burstT: burstGap(s.v), burstNext: next, burstV: s.v });
  return true;
}
function updateBursts(dt) {
  for (const r of robots) {
    if (!(r.burst > 0)) continue;
    if (!r.alive) { r.burst = 0; continue; }
    r.burstT -= dt;
    if (r.burstT > 0) continue;
    const s = r.burstNext() || { v: r.burstV, from: spawnPoint(r) };
    const v = spread(s.v);
    warFire(r, v, s.from);
    r.burst--; r.burstT = burstGap(v);
  }
}

function warTryFire() {
  const r = G.active;
  if (!r) return;
  if (!readyToFire(r)) { reloadNag(); return; }
  // Cada bloque de la ráfaga sale hacia donde apuntes en ese momento
  startBurst(r, () => (G.active === r && G.aim ? { v: G.aim.v.clone(), from: G.aim.from.clone() } : null), WAR_RELOAD);
}

function updateWar(dt) {
  if (G.mode !== 'war') return;
  G.windT += dt;
  if (G.windT > 12) { G.windT = 0; setWind(); toast('Cambió el viento', 900); if (G.net) netEvent({ e: 't', text: 'Cambió el viento', ms: 900 }); }
  G.walkLock = Math.max(0, G.walkLock - dt);
  for (const r of robots) r.cool = Math.max(0, (r.cool || 0) - dt);
  updateBursts(dt);

  // Mantener el clic: dispara una ráfaga cada vez que el robot recarga
  if (G.firing && canControl() && readyToFire(G.active) && G.aim) warTryFire();

  // La computadora camina por la mesa y dispara con cada robot cuando recarga
  const redAlive = robots.some((r) => r.team === 'red' && r.alive);
  if (G.net && NET.role === 'host') netHostWar(dt);
  if (G.vsCPU && redAlive) for (const r of robots) {
    if (r.team !== 'blue') continue;
    if (!r.alive) { cpuStopWalk(r); continue; }
    updateCpuWalk(r, dt);
    if (!readyToFire(r)) continue;
    const plan = planCpuShot(r);
    if (!plan.inRange) { r.cool = 0.8; if (!r.walk) cpuStartWalk(r, true); continue; }
    // La CPU sigue tirando de a un bloque (con ráfagas sería el triple de difícil)
    cpuStopWalk(r);
    warFire(r, aimDir(plan.yaw, plan.pitch).multiplyScalar(shotSpeed(plan.power)), spawnPoint(r));
    r.cool = rand(...WAR_CPU_RELOAD);
  }

  // Si algo llega rápido cerca mientras caminas, el robot se planta y recibe el golpe con física normal
  if (G.active && G.walkGroup && threatNear(G.active, G.walkGroup)) { endWalk(); G.walkLock = 0.6; }

  // Limpieza: bloques caídos de la mesa y los más viejos si hay demasiados
  G.shots = G.shots.filter((s) => {
    s.age += dt;
    if (!things.includes(s.thing)) return false;
    if (s.thing.body.position.y < TABLE.top - 4) { removeThing(s.thing); return false; }
    return true;
  });
  while (G.shots.length > WAR_MAX_SHOTS) {
    const i = G.shots.findIndex((s) => s.hit);
    if (i < 0) break;
    removeThing(G.shots[i].thing); G.shots.splice(i, 1);
  }

  checkPilots(false);
  if (G.active && !G.active.alive) {
    endWalk();
    const next = robots.find((r) => r.team === G.myTeam && r.alive);
    if (next) { G.active = next; G.target = null; G.air = null; G.locked = false; G.camFollow = 0; renderTeams(); }
  }
  const blueAlive = robots.some((r) => r.team === 'blue' && r.alive);
  if (!redAlive || !blueAlive) { endWalk(); if (G.remote) endWalk(G.remote); robots.forEach(cpuStopWalk); gameOver(redAlive ? 'red' : blueAlive ? 'blue' : null); }
}

function warSub() {
  const r = G.active;
  if (!r) return '';
  return readyToFire(r) ? `${r.short} · ¡listo para disparar!` : r.burst > 0 ? `${r.short} · ¡ráfaga!` : `${r.short} · recargando ${(r.cool || 0).toFixed(1)} s`;
}

// ---------- Munición a la vista: anillo de recarga en la mira, balas y barra abajo ----------
const RING = 2 * Math.PI * 24;   // perímetro del anillo de la mira
let wasReady = true, nagT = 0;
function setRing(prog, state) {
  $('ch-ring').setAttribute('stroke-dasharray', `${(prog * RING).toFixed(1)} ${RING.toFixed(1)}`);
  $('crosshair').classList.toggle('ready', state === 'ready');
  $('crosshair').classList.toggle('reloading', state === 'reloading');
}
function updateAmmoHud() {
  const human = canControl(), r = G.active, war = human && G.mode === 'war' && r && r.alive;
  $('crosshair').hidden = !(human && mouseLocked() && !G.overview);
  $('lock-hint').hidden = !(human && !G.overview && lockHint());
  $('ammo').hidden = $('ch-ammo').hidden = !war;
  if (!war) { setRing(1, ''); $('btn-fire').style.setProperty('--reload', 1); wasReady = true; return; }
  const cool = r.cool || 0, burst = r.burst || 0, ready = cool <= 0 && !burst;
  const loaded = burst > 0 ? burst : ready ? WAR_BURST : 0;
  const prog = ready ? 1 : clamp(1 - cool / WAR_RELOAD, 0, 1);
  for (const id of ['ammo-pips', 'ch-ammo']) [...$(id).children].forEach((pip, i) => pip.classList.toggle('on', i < loaded));
  $('reload-fill').style.width = `${prog * 100}%`;
  $('ammo-text').textContent = ready ? '¡Listo! Ráfaga de 3' : burst > 0 ? '¡Fuego!' : `Recargando ${cool.toFixed(1)} s`;
  $('ammo').classList.toggle('ready', ready);
  $('ammo').classList.toggle('reloading', !ready);
  $('btn-fire').style.setProperty('--reload', prog.toFixed(3));
  setRing(prog, ready ? 'ready' : 'reloading');
  if (ready && !wasReady) {
    const ch = $('crosshair');
    ch.classList.remove('pulse'); void ch.offsetWidth; ch.classList.add('pulse');
    if (!G.firing) tune([660, 990], 'triangle', 0.05, 0.06);   // "clic-clac": ya puedes disparar
  }
  wasReady = ready;
}
// Disparar sin haber recargado: la munición tiembla y suena en vacío
function reloadNag() {
  const now = performance.now();
  if (now - nagT < 400) return;
  nagT = now;
  const el = $('ammo');
  el.classList.remove('nope'); void el.offsetWidth; el.classList.add('nope');
  knock(1.2, 0.5, 0.5);
  toast('Recargando…', 600);
}

// ---------- La computadora también camina ----------
function nearestFoe(r) {
  const d = r.die.body.position;
  let best = null, bd = Infinity;
  for (const o of robots) if (o.alive && o.team !== r.team) {
    const p = o.die.body.position, dist = Math.hypot(p.x - d.x, p.z - d.z);
    if (dist < bd) { bd = dist; best = o; }
  }
  return { foe: best, dist: bd };
}
function cpuStartWalk(r, approach = false) {
  const { foe, dist } = nearestFoe(r);
  if (!foe) return;
  const d = r.die.body.position, f = foe.die.body.position;
  const to = new THREE.Vector3(f.x - d.x, 0, f.z - d.z).normalize();
  let dir;
  if (approach || dist > 80) dir = to;                                        // acercarse
  else if (dist < 30) dir = to.clone().negate();                              // alejarse
  else dir = new THREE.Vector3(-to.z, 0, to.x).multiplyScalar(Math.random() < 0.5 ? 1 : -1)   // moverse de lado para esquivar
    .addScaledVector(to, rand(-0.4, 0.4)).normalize();
  const group = robotGroup(r);
  if (!groupSettled(group)) return;
  const box = unionBox(group);
  const blockers = [...things.filter((t) => t.kind === 'prop').map((t) => boxOf(t).expandByScalar(0.3)),
    ...robots.filter((o) => o !== r && o.alive).map((o) => unionBox(robotGroup(o)).expandByScalar(0.5))].filter((b) => !b.intersectsBox(box));
  const speed = WALK_SPEED * 0.85;
  for (const t of group) { t.body.type = CANNON.Body.KINEMATIC; t.body.velocity.set(dir.x * speed, 0, dir.z * speed); t.body.angularVelocity.setZero(); t.body.wakeUp(); }
  r.walk = { group, box, from: new THREE.Vector3().copy(d), vx: dir.x * speed, vz: dir.z * speed, t: rand(0.7, 1.8), blockers };
}
function cpuStopWalk(r) {
  if (!r.walk) return;
  for (const t of r.walk.group) { t.body.type = CANNON.Body.DYNAMIC; t.body.velocity.setZero(); t.body.angularVelocity.setZero(); t.body.wakeUp(); }
  r.walk = null;
}
function updateCpuWalk(r, dt) {
  const w = r.walk;
  if (!w) {
    // Entre disparo y disparo, a veces se mueve
    if (r.cool > 1.2 && Math.random() < dt * 0.9) cpuStartWalk(r);
    return;
  }
  w.t -= dt;
  const d = r.die.body.position;
  const b = w.box.clone().translate(new THREE.Vector3(d.x - w.from.x + w.vx * 0.4, 0, d.z - w.from.z + w.vz * 0.4));
  const blocked = b.min.x < -TABLE.hx + 0.5 || b.max.x > TABLE.hx - 0.5 || b.min.z < -TABLE.hz + 0.5 || b.max.z > TABLE.hz - 0.5
    || w.blockers.some((k) => k.intersectsBox(b));
  // Igual que tú: si le llega un bloque cerca, se planta y recibe el golpe
  const incoming = threatNear(r, w.group);
  if (w.t <= 0 || blocked || incoming) cpuStopWalk(r);
}
