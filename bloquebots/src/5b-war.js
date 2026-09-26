
// ---------- Guerra total: sin turnos, todos disparan a la vez ----------
const WAR_RELOAD = 2.5;          // recarga de cada robot tuyo (s)
const WAR_CPU_RELOAD = [4.5, 6.5];
const WAR_MAX_SHOTS = 30;        // bloques disparados que se quedan en la mesa

function setWind(s = Math.pow(Math.random(), 0.8)) {
  const a = rand(0, Math.PI * 2);
  G.wind = { angle: a, strength: s, x: Math.cos(a) * s * WIND_MAX, z: Math.sin(a) * s * WIND_MAX };
  fanAngleTarget = a;
}

function startWar() {
  G.mode = 'war'; G.team = 'red'; G.shots = []; G.windT = 0; G.walkLock = 0; G.timer = 999;
  setWind(rand(0, 0.4));
  G.active = robots.find((r) => r.team === 'red' && r.alive);
  for (const r of robots) r.cool = r.team === 'red' ? 0 : rand(4, 6);
  aimAtNearestEnemy();
  G.viewYaw = G.yaw; G.camOffset = 0; G.arc = 0.35; G.target = null; G.locked = false; G.aim = null;
  G.walkLeft = WALK_BUDGET; G.moved = false; G.ai = null;
  $('turn-title').textContent = '¡Guerra total!';
  $('turn-title').style.color = '#ffb08a';
  renderTeams();
  toast('¡Guerra total!', 1400, '#ffb08a');
  tune([392, 523, 659], 'square', 0.1, 0.12);
}

function warFire(robot, v, from) {
  if (robot === G.active) endWalk();
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

function warTryFire() {
  const r = G.active;
  if (!r) return;
  if (r.cool > 0) { toast('Recargando…', 600); return; }
  warFire(r, G.aim.v, G.aim.from);
  r.cool = WAR_RELOAD;
}

function updateWar(dt) {
  if (G.mode !== 'war') return;
  G.windT += dt;
  if (G.windT > 12) { G.windT = 0; setWind(); toast('Cambió el viento', 900); }
  G.walkLock = Math.max(0, G.walkLock - dt);
  for (const r of robots) r.cool = Math.max(0, (r.cool || 0) - dt);

  // Disparo continuo mientras mantienes el clic
  if (G.firing && canControl() && G.active && G.active.cool <= 0 && G.aim && G.aim.ok) warTryFire();

  // La computadora camina por la mesa y dispara con cada robot cuando recarga
  const redAlive = robots.some((r) => r.team === 'red' && r.alive);
  if (G.vsCPU && redAlive) for (const r of robots) {
    if (r.team !== 'blue') continue;
    if (!r.alive) { cpuStopWalk(r); continue; }
    updateCpuWalk(r, dt);
    if (r.cool > 0) continue;
    const plan = planCpuShot(r);
    if (!plan.inRange) { r.cool = 0.8; if (!r.walk) cpuStartWalk(r, true); continue; }
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
    const next = robots.find((r) => r.team === 'red' && r.alive);
    if (next) { G.active = next; G.target = null; G.locked = false; G.viewYaw = G.yaw; G.camOffset = 0; renderTeams(); }
  }
  const blueAlive = robots.some((r) => r.team === 'blue' && r.alive);
  if (!redAlive || !blueAlive) { endWalk(); robots.forEach(cpuStopWalk); gameOver(redAlive ? 'red' : blueAlive ? 'blue' : null); }
}

function warSub() {
  const r = G.active;
  if (!r) return '';
  return r.cool > 0 ? `${r.short} · recargando ${r.cool.toFixed(1)} s` : `${r.short} · ¡listo para disparar!`;
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
