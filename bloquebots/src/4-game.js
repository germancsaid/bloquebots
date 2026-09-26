
// ---------- Sonido sintetizado (madera, dado, lanzamiento) ----------
const audio = { ctx: null, master: null, noise: null, on: true, budget: 0 };
function ensureAudio() {
  try {
    if (!audio.ctx) {
      audio.ctx = new (window.AudioContext || window.webkitAudioContext)();
      audio.master = audio.ctx.createGain(); audio.master.gain.value = 0.7;
      audio.master.connect(audio.ctx.destination);
      const len = audio.ctx.sampleRate * 0.4;
      audio.noise = audio.ctx.createBuffer(1, len, audio.ctx.sampleRate);
      const d = audio.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (audio.ctx.state === 'suspended') audio.ctx.resume();
  } catch { audio.ctx = null; }
}
function knock(intensity, pitch = 1, bright = 1) {
  if (!audio.on || !audio.ctx || audio.budget <= 0) return;
  audio.budget--;
  const ctx = audio.ctx, t = ctx.currentTime, vol = Math.min(0.55, 0.05 + intensity * 0.025);
  const src = ctx.createBufferSource(); src.buffer = audio.noise;
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = (900 + Math.random() * 900) * pitch * bright; bp.Q.value = 2.5;
  const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
  src.connect(bp).connect(g).connect(audio.master); src.start(t, Math.random() * 0.2); src.stop(t + 0.1);
  const o = ctx.createOscillator(); o.type = 'triangle';
  o.frequency.setValueAtTime((380 + Math.random() * 240) * pitch, t); o.frequency.exponentialRampToValueAtTime(170 * pitch, t + 0.07);
  const g2 = ctx.createGain(); g2.gain.setValueAtTime(vol * 0.9, t); g2.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
  o.connect(g2).connect(audio.master); o.start(t); o.stop(t + 0.09);
}
function whoosh(power) {
  if (!audio.on || !audio.ctx) return;
  const ctx = audio.ctx, t = ctx.currentTime;
  const src = ctx.createBufferSource(); src.buffer = audio.noise;
  const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.2;
  f.frequency.setValueAtTime(300, t); f.frequency.exponentialRampToValueAtTime(1400 + power * 1800, t + 0.25);
  const g = ctx.createGain(); g.gain.setValueAtTime(0.001, t); g.gain.exponentialRampToValueAtTime(0.25 + power * 0.2, t + 0.06); g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
  src.connect(f).connect(g).connect(audio.master); src.start(t); src.stop(t + 0.4);
}
function tune(notes, type = 'square', step = 0.11, vol = 0.12) {
  if (!audio.on || !audio.ctx) return;
  const ctx = audio.ctx, t0 = ctx.currentTime;
  notes.forEach((hz, i) => {
    const o = ctx.createOscillator(); o.type = type; o.frequency.value = hz;
    const g = ctx.createGain(), t = t0 + i * step;
    g.gain.setValueAtTime(0.001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.02); g.gain.exponentialRampToValueAtTime(0.001, t + step * 1.6);
    o.connect(g).connect(audio.master); o.start(t); o.stop(t + step * 1.8);
  });
}

// ---------- Estado de la partida ----------
const DEG = Math.PI / 180;
const WIND_MAX = 5;           // aceleración máxima del viento (unidades/s²)
const TURN_TIME = 45;
const G = {
  mode: 'menu', vsCPU: true, team: 'red', next: { red: 0, blue: 0 }, active: null,
  yaw: 0, pitch: 35 * DEG, power: 0, charging: false, timer: TURN_TIME,
  wind: { x: 0, z: 0, strength: 0, angle: 0 },
  shot: null, shotHit: false, impact: new THREE.Vector3(), settleT: 0, quietT: 0,
  timeScale: 1, slowmo: 0, shake: 0, overview: false, camDist: 16, ai: null, turnNo: 0,
  walkLeft: 0, walkGroup: null, walkBox: null, walkFrom: null, blockers: [], walking: false, walkPhase: 0, moved: false,
  picks: { red: ['alto', 'tanque'], blue: ['alto', 'tanque'] },
  camOffset: 0, map: 'escritorio', war: false, shots: [], windT: 0, walkLock: 0, viewYaw: 0, arc: 0.35, target: null, targetN: null, locked: false, aim: null,
};
const WALK_SPEED = 8, WALK_BUDGET = 26, SHOT_MASS = 3;
const isCpuTurn = () => G.vsCPU && G.team === 'blue';

// ---------- HUD ----------
let toastTimer = 0;
function toast(msg, ms = 1600, color = '') {
  const el = $('toast');
  el.textContent = msg; el.style.color = color; el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}
function renderTeams() {
  $('teams').innerHTML = ['red', 'blue'].map((team) => {
    const chips = robots.filter((r) => r.team === team).map((r) =>
      `<span class="bot-chip${r.alive ? '' : ' out'}${r === G.active && G.mode !== 'over' ? ' active' : ''}" style="color:${team === 'red' ? '#ff8a7e' : '#8fb8ff'}"><span class="pip"></span>${esc(r.short)}</span>`).join('');
    const who = G.vsCPU ? (team === 'red' ? 'Tú' : 'CPU') : TEAM_NAMES[team];
    return `<div class="team-row"><span class="team-name" style="color:${team === 'red' ? '#ff8a7e' : '#8fb8ff'}">${who}</span>${chips}</div>`;
  }).join('');
  for (const r of robots) r.label.userData.draw(r.name, !r.alive, r === G.active && (G.mode === 'aim' || G.mode === 'war'));
}
function setTurnText() {
  const r = G.active;
  if (!r) return;
  const who = G.vsCPU ? (r.team === 'red' ? 'Tu turno' : 'Turno de la CPU') : `Turno de ${TEAM_NAMES[r.team]}`;
  $('turn-title').textContent = who;
  $('turn-title').style.color = r.team === 'red' ? '#ff8a7e' : '#8fb8ff';
}
function updateHud() {
  const secs = Math.max(0, Math.ceil(G.timer));
  const sub = G.mode === 'war' ? warSub() : G.mode === 'aim' ? `${G.active.short} · ${secs} s` : G.mode === 'flying' ? '¡Bloque en el aire!' : G.mode === 'settle' ? 'Esperando a que todo se detenga…' : '';
  $('turn-sub').textContent = sub;
  const human = (G.mode === 'aim' || G.mode === 'war') && !isCpuTurn();
  const ok = !human || (G.aim && G.aim.ok);
  $('aim-angle').textContent = ok ? `Ángulo ${Math.round(G.pitch / DEG)}°` : 'Ángulo –';
  $('aim-power').textContent = ok ? `Potencia ${Math.round(G.power * 100)}%` : 'Potencia –';
  let note = '';
  if (human) {
    if (!G.target) note = 'Mueve el ratón para apuntar · clic para disparar';
    else if (!G.aim || !G.aim.ok) note = 'Fuera de alcance: acércate caminando o elige otro punto';
    else {
      const d = Math.hypot(G.target.x - G.aim.from.x, G.target.z - G.aim.from.z) * 2.5;
      note = G.blocked ? 'Hay algo en el camino: sube el arco (↑)' : `Distancia ${Math.round(d)} cm · Arco ${Math.round(G.arc * 100)}% (↑↓) · clic para disparar`;
    }
  }
  $('aim-note').textContent = note;
  $('aim-note').classList.toggle('warn', human && !!G.target && (!G.aim || !G.aim.ok || G.blocked));
  $('power-fill').style.width = `${G.power * 100}%`;
  $('walk-fill').style.width = `${(G.walkLeft / WALK_BUDGET) * 100}%`;
  $('aim-walk').textContent = `Pasos ${Math.round((G.walkLeft / WALK_BUDGET) * 100)}%`;
  // Flecha del viento relativa a la cámara: "arriba" = hacia donde mira la cámara
  const camDir = new THREE.Vector3(); camera.getWorldDirection(camDir);
  const rel = Math.atan2(G.wind.z, G.wind.x) - Math.atan2(camDir.z, camDir.x);
  $('wind-arrow').style.transform = `rotate(${rel}rad)`;
  $('wind-arrow').style.opacity = G.wind.strength < 0.05 ? 0.25 : 1;
  $('wind-text').textContent = G.wind.strength < 0.05 ? 'Calma' : `${Math.round(G.wind.strength * 10)} / 10`;
}

// ---------- Montar la partida ----------
function clearWorld() {
  for (const t of [...things]) removeThing(t);
  for (const r of robots) scene.remove(r.label);
  robots.length = 0;
}
function setupMatch() {
  clearWorld();
  const map = applyMap(G.map), sp = map.spawns || DEFAULT_SPAWNS;
  const zs = Math.random() < 0.5 ? 1 : -1;
  for (const t of ['red', 'blue']) G.picks[t] = G.picks[t].map((k) => (DESIGNS[k] ? k : 'alto'));
  G.picks.red.forEach((key, i) => buildRobot(DESIGNS[key].make(), 'red', sp.red[i][0], sp.red[i][1] * zs, 0, i));
  G.picks.blue.forEach((key, i) => buildRobot(DESIGNS[key].make(), 'blue', sp.blue[i][0], sp.blue[i][1] * zs, Math.PI, i));
  // Si hay dos robots iguales en un equipo, se numeran
  const count = {};
  for (const r of robots) count[r.team + r.short] = (count[r.team + r.short] || 0) + 1;
  for (const r of robots) if (count[r.team + r.short] > 1) {
    r.short = `${r.short} ${r.idx + 1}`; r.name = `${TEAM_NAMES[r.team]} ${r.short}`;
  }
  // Dejar que todo se asiente antes de empezar
  for (let i = 0; i < 90; i++) world.step(FIXED_DT);
  for (const t of things) syncMesh(t);
  for (const r of robots) r.dieStartY = r.die.body.position.y - TABLE.top;
}

function startMatch(vsCPU, war = false) {
  G.vsCPU = vsCPU; G.war = war;
  openPicker();
}

function beginMatch() {
  setupMatch();
  G.shot = null; G.overview = false;
  G.next = { red: 0, blue: 0 };
  G.team = 'red';
  G.turnNo = 0;
  $('menu').hidden = true;
  if (G.war) startWar(); else startTurn();
}

function pickRobot(team) {
  const list = robots.filter((r) => r.team === team);
  for (let k = 0; k < list.length; k++) {
    const r = list[(G.next[team] + k) % list.length];
    if (r.alive) { G.next[team] = (list.indexOf(r) + 1) % list.length; return r; }
  }
  return null;
}
function aimAtNearestEnemy() {
  const me = G.active.die.body.position;
  let best = null, bd = Infinity;
  for (const r of robots) if (r.alive && r.team !== G.active.team) {
    const p = r.die.body.position, d = Math.hypot(p.x - me.x, p.z - me.z);
    if (d < bd) { bd = d; best = p; }
  }
  if (best) G.yaw = Math.atan2(best.z - me.z, best.x - me.x);
}

function startTurn() {
  G.active = pickRobot(G.team);
  G.turnNo++;
  const a = rand(0, Math.PI * 2), s = G.turnNo === 1 ? rand(0, 0.3) : Math.pow(Math.random(), 0.8);
  G.wind = { angle: a, strength: s, x: Math.cos(a) * s * WIND_MAX, z: Math.sin(a) * s * WIND_MAX };
  fanAngleTarget = a;
  G.pitch = 35 * DEG; G.power = 0; G.charging = false; G.timer = TURN_TIME;
  G.walkLeft = WALK_BUDGET; G.moved = false; G.walkGroup = null; G.walking = false;
  aimAtNearestEnemy();
  G.viewYaw = G.yaw; G.camOffset = 0; G.arc = 0.35; G.target = null; G.locked = false; G.aim = null;
  G.mode = 'aim';
  G.ai = isCpuTurn() ? planCpuShot(G.active) : null;
  setTurnText(); renderTeams();
  toast(G.vsCPU ? (G.team === 'red' ? 'Tu turno' : 'Turno de la CPU') : `Turno de ${TEAM_NAMES[G.team]}`, 1100, G.team === 'red' ? '#ff8a7e' : '#8fb8ff');
}

function selectRobot(r) {
  if (!canControl() || G.charging || !r || !r.alive || r.team !== G.team || r === G.active) return;
  if (G.moved) { toast('Ya moviste este robot', 1000); return; }
  endWalk();
  G.active = r;
  aimAtNearestEnemy();
  G.viewYaw = G.yaw; G.camOffset = 0;
  renderTeams();
}
function switchRobot() {
  if (!canControl()) return;
  const list = robots.filter((r) => r.team === G.team && r.alive);
  if (list.length < 2) { toast('No hay otro robot en pie', 1000); return; }
  selectRobot(list[(list.indexOf(G.active) + 1) % list.length]);
}

// ---------- Caminar ----------
// Mientras camina, el robot se mueve como una sola pieza (cuerpos cinemáticos).
// Al disparar o terminar el turno vuelve a ser física normal.
function boxOf(t) { return new THREE.Box3().setFromObject(t.mesh); }
function robotGroup(robot) {
  const boxes = new Map();
  const box = (t) => boxes.get(t) || boxes.set(t, boxOf(t).expandByScalar(0.06)).get(t);
  const group = [robot.die], queue = [robot.die], rest = new Set(robot.blocks);
  while (queue.length) {
    const a = queue.pop();
    for (const b of [...rest]) if (box(a).intersectsBox(box(b))) { rest.delete(b); group.push(b); queue.push(b); }
  }
  return group;
}
function unionBox(list) { const u = new THREE.Box3(); for (const t of list) u.union(boxOf(t)); return u; }

// Solo se puede caminar con el robot quieto: si se está tambaleando o se le caen piezas,
// manda la física (si no, esas piezas quedarían congeladas en el aire)
function groupSettled(group) {
  return group.every((t) => t.body.velocity.lengthSquared() < 0.5 && t.body.angularVelocity.lengthSquared() < 1.0);
}
// ¿Viene algo rápido hacia el robot? (un disparo enemigo o una pieza que sale volando)
function threatNear(robot, group, radius = 6) {
  const d = robot.die.body.position, own = new Set(group);
  for (const t of things) {
    if (own.has(t) || t.body.type !== CANNON.Body.DYNAMIC) continue;
    const v2 = t.body.velocity.lengthSquared();
    if (v2 < 144) continue;
    if (t.kind === 'shot' && G.shots && G.shots.some((s) => s.thing === t && !s.hit && s.team === robot.team)) continue;
    if (t.body.position.distanceTo(d) < radius) return true;
  }
  return false;
}
let wobbleToastT = 0;
const TURN_SPEED = 2.2;   // giro del robot (rad/s)
const qYaw = (a) => new THREE.Quaternion().setFromAxisAngle(Y_AXIS, a);
function beginWalk() {
  if (G.walkGroup) return true;
  const group = robotGroup(G.active);
  if (!groupSettled(group)) {
    if (performance.now() - wobbleToastT > 1500) { wobbleToastT = performance.now(); toast('Tu robot se tambalea: espera a que se asiente', 900); }
    return false;
  }
  G.walkGroup = group;
  // Pose del robot: un pivote (bajo el piloto) y un giro. Cada pieza guarda su posición relativa
  // para que al caminar y girar el robot se mueva entero, sin deformarse.
  const d = G.active.die.body.position, yaw0 = G.active.yaw || 0, qInv = qYaw(-yaw0);
  const pivot = new THREE.Vector3(d.x, 0, d.z);
  const locals = group.map((t) => ({
    t,
    p: new THREE.Vector3(t.body.position.x - pivot.x, t.body.position.y, t.body.position.z - pivot.z).applyQuaternion(qInv),
    q: qInv.clone().multiply(new THREE.Quaternion(t.body.quaternion.x, t.body.quaternion.y, t.body.quaternion.z, t.body.quaternion.w)),
  }));
  let R = 1, top = 1;
  for (const l of locals) { R = Math.max(R, Math.hypot(l.p.x, l.p.z) + 1.6); top = Math.max(top, l.p.y + 1.6); }
  G.walkPose = { pivot, yaw: yaw0, locals, R, top };
  G.walkV = { vx: 0, vz: 0 }; G.walkW = 0;
  G.blockers = [];
  for (const t of things) if (t.kind === 'prop') G.blockers.push(boxOf(t).expandByScalar(0.2));
  for (const r of robots) if (r !== G.active && r.alive) G.blockers.push(unionBox(robotGroup(r)).expandByScalar(0.2));
  // Si ya está tocando algo al empezar, eso no lo bloquea (para que pueda alejarse)
  const start = walkSquare(pivot.x, pivot.z);
  G.blockers = G.blockers.filter((b) => !b.intersectsBox(start));
  for (const t of group) {
    t.body.type = CANNON.Body.KINEMATIC;
    t.body.velocity.setZero(); t.body.angularVelocity.setZero();
    t.body.wakeUp();
  }
  return true;
}

// Zona que ocupa el robot vista desde arriba (cuadrada, así sirve gire como gire)
function walkSquare(x, z) {
  const P = G.walkPose;
  return new THREE.Box3(new THREE.Vector3(x - P.R, TABLE.top, z - P.R), new THREE.Vector3(x + P.R, TABLE.top + P.top, z + P.R));
}
function walkBlocked(dx, dz) {
  const p = G.walkPose.pivot, b = walkSquare(p.x + dx, p.z + dz);
  if (b.min.x < -TABLE.hx + 0.5 || b.max.x > TABLE.hx - 0.5 || b.min.z < -TABLE.hz + 0.5 || b.max.z > TABLE.hz - 0.5) return true;
  return G.blockers.some((k) => k.intersectsBox(b));
}

// fwd: W/S, side: A/D (de lado), turn: ← → (gira el robot)
function updateWalk(dt, fwd, side, turn = 0) {
  let vx = 0, vz = 0, w = 0;
  if ((fwd || side || turn) && G.walkLock <= 0 && beginWalk()) {
    const yaw = G.walkPose.yaw;
    const front = { x: Math.cos(yaw), z: -Math.sin(yaw) }, right = { x: Math.sin(yaw), z: Math.cos(yaw) };
    if ((fwd || side) && G.walkLeft > 0) {
      vx = front.x * fwd + right.x * side; vz = front.z * fwd + right.z * side;
      const len = Math.hypot(vx, vz) || 1;
      vx = (vx / len) * WALK_SPEED; vz = (vz / len) * WALK_SPEED;
      const look = 0.35;
      if (walkBlocked(vx * look, vz * look)) {
        if (!walkBlocked(vx * look, 0)) vz = 0;
        else if (!walkBlocked(0, vz * look)) vx = 0;
        else { vx = 0; vz = 0; }
      }
    }
    w = turn * TURN_SPEED;
  }
  const speed = Math.hypot(vx, vz);
  G.walkV = { vx, vz }; G.walkW = w;
  G.walking = speed > 0 || w !== 0;
  if (G.walkGroup && G.walking) for (const t of G.walkGroup) t.body.wakeUp();
  if (G.walking) {
    G.moved = true;
    G.walkLeft = Math.max(0, G.walkLeft - speed * dt);
    const before = G.walkPhase;
    G.walkPhase += dt * 9;
    if (Math.floor(before / Math.PI) !== Math.floor(G.walkPhase / Math.PI)) knock(1.5, 0.8, 0.8);
  }
}

// En cada paso de física: coloca cada pieza exactamente donde toca (velocidad = distancia / tiempo),
// así el robot empuja lo que encuentra y nunca se desarma ni se "estira" al girar.
function applyWalkStep(dt) {
  const P = G.walkPose;
  if (!G.walkGroup || !P) return;
  const v = G.walkV || { vx: 0, vz: 0 }, w = G.walkW || 0;
  const qNow = qYaw(P.yaw);
  P.pivot.x += v.vx * dt; P.pivot.z += v.vz * dt; P.yaw += w * dt;
  const qNext = qYaw(P.yaw);
  for (const l of P.locals) {
    const b = l.t.body, qc = qNow.clone().multiply(l.q);
    b.quaternion.set(qc.x, qc.y, qc.z, qc.w);
    const target = l.p.clone().applyQuaternion(qNext);
    b.velocity.set((target.x + P.pivot.x - b.position.x) / dt, (target.y - b.position.y) / dt, (target.z + P.pivot.z - b.position.z) / dt);
    b.angularVelocity.set(0, w, 0);
  }
  G.active.yaw = P.yaw;
}

function endWalk() {
  if (!G.walkGroup) return;
  for (const t of G.walkGroup) {
    t.body.type = CANNON.Body.DYNAMIC;
    t.body.velocity.setZero(); t.body.angularVelocity.setZero();
    t.body.wakeUp();
  }
  G.walkGroup = null; G.walking = false; G.walkPose = null; G.walkW = 0;
}

// ---------- Disparo ----------
function aimDir(yaw = G.yaw, pitch = G.pitch) {
  return new THREE.Vector3(Math.cos(pitch) * Math.cos(yaw), Math.sin(pitch), Math.cos(pitch) * Math.sin(yaw));
}
// El bloque sale por encima del piloto (y por encima de cualquier pieza que tenga encima)
function spawnPoint(robot) {
  const d = robot.die.body.position;
  let top = d.y + 2.6;
  for (const b of robot.blocks) {
    const p = b.body.position;
    if (Math.abs(p.x - d.x) < 2.2 && Math.abs(p.z - d.z) < 2.2) top = Math.max(top, p.y + 3.2);
  }
  return new THREE.Vector3(d.x, top, d.z);
}
const SHOT_MIN = 10, SHOT_MAX = 62;
const shotSpeed = (power) => SHOT_MIN + power * (SHOT_MAX - SHOT_MIN);
const shotAccel = () => new THREE.Vector3(G.wind.x, GRAVITY, G.wind.z);

// ---------- Mira de precisión ----------
// Velocidad de salida exacta para que el centro del bloque pase por `to` después de n pasos
// de física (misma fórmula que usa el motor: gravedad + viento, sin rozamiento en vuelo).
function launchVelocity(from, to, n, a = shotAccel()) {
  const k = FIXED_DT * FIXED_DT * n * (n + 1) / 2;
  return new THREE.Vector3(to.x - from.x - a.x * k, to.y - from.y - a.y * k, to.z - from.z - a.z * k).divideScalar(n * FIXED_DT);
}
// Tiempos de vuelo posibles con la potencia disponible (del tiro más directo al más bombeado)
function feasibleRange(from, to) {
  let lo = null, hi = null;
  for (let n = 12; n <= 480; n += 3) {
    const s = launchVelocity(from, to, n).length();
    if (s >= SHOT_MIN && s <= SHOT_MAX) { if (lo === null) lo = n; hi = n; }
  }
  return lo === null ? null : [lo, hi];
}
function solveShot(from, to, arc) {
  const r = feasibleRange(from, to);
  if (!r) return null;
  const n = Math.round(r[0] + (r[1] - r[0]) * arc);
  const v = launchVelocity(from, to, n);
  return { v, n, yaw: Math.atan2(v.z, v.x), pitch: Math.atan2(v.y, Math.hypot(v.x, v.z)), power: clamp((v.length() - SHOT_MIN) / (SHOT_MAX - SHOT_MIN), 0, 1) };
}
function updateAim() {
  G.aim = null;
  if (!G.target || !G.active) return;
  const from = spawnPoint(G.active);
  const sol = solveShot(from, G.target, G.arc);
  if (!sol) { G.aim = { ok: false, from }; return; }
  G.aim = { ok: true, from, ...sol };
  G.yaw = sol.yaw; G.pitch = sol.pitch; G.power = sol.power;
}
function tryFire() {
  ensureAudio();
  if (!canControl()) return;
  if (!G.target) { toast('Apunta con el ratón a donde quieras pegar', 1300); return; }
  if (!G.aim || !G.aim.ok) { toast('Fuera de alcance', 1100); return; }
  if (G.mode === 'war') { warTryFire(); return; }
  fire(G.aim.v, G.aim.from);
}

function fire(v = aimDir().multiplyScalar(shotSpeed(Math.max(0.02, G.power))), from = spawnPoint(G.active)) {
  if (G.mode !== 'aim') return;
  endWalk();
  const power = clamp((v.length() - SHOT_MIN) / (SHOT_MAX - SHOT_MIN), 0, 1);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), v.clone().normalize());
  const shot = makeBlock(from, q, MAT.wood, 'shot', SHOT_MASS);
  shot.body.velocity.set(v.x, v.y, v.z);
  shot.body.angularVelocity.set(0, 0, 0);
  shot.body.linearDamping = 0;   // en vuelo no frena: así la trayectoria calculada es exacta
  shot.body.allowSleep = false;
  shot.body.addEventListener('collide', (e) => { if (G.shot === shot) onShotCollide(e); });
  G.shot = shot; G.shotHit = false; G.charging = false;
  G.mode = 'flying'; G.settleT = 0; G.quietT = 0;
  whoosh(power);
  renderTeams();
}

function onShotCollide(e) {
  if (G.shotHit) return;
  G.shotHit = true;
  const speed = G.shot.body.velocity.length();
  G.impact.copy(G.shot.body.position);
  const other = e.body.userData;
  const hitRobot = other && other.robot;
  if (hitRobot && speed > 14) { G.slowmo = 0.9; G.shake = Math.min(1.2, speed / 40); toast('¡Impacto!', 900); }
  else G.shake = Math.min(0.6, speed / 60);
  G.shot.body.allowSleep = true;
  G.shot.body.linearDamping = 0.04;
  G.mode = 'settle';
}

function checkPilots(final) {
  for (const r of robots) {
    if (!r.alive) continue;
    const y = r.die.body.position.y - TABLE.top;
    const offTable = y < -1;
    if (offTable || y < Math.max(0.75, r.dieStartY * 0.55)) {
      r.alive = false;
      toast(offTable ? `¡${r.name} se cayó de la mesa!` : `¡Cayó el piloto de ${r.name}!`, 1800, r.team === 'red' ? '#ff8a7e' : '#8fb8ff');
      tune([392, 330, 262], 'triangle', 0.14, 0.14);
      renderTeams();
    }
  }
  if (final) endTurn();
}

function endTurn() {
  if (G.mode === 'over') return;
  endWalk();
  const alive = (t) => robots.some((r) => r.team === t && r.alive);
  const red = alive('red'), blue = alive('blue');
  if (!red || !blue) return gameOver(red ? 'red' : blue ? 'blue' : null);
  G.team = G.team === 'red' ? 'blue' : 'red';
  G.shot = null;
  startTurn();
}

function gameOver(winner) {
  G.mode = 'over'; G.active = null; renderTeams();
  const title = winner ? (G.vsCPU ? (winner === 'red' ? '¡Ganaste!' : 'Gana la CPU') : `¡Gana ${TEAM_NAMES[winner]}!`) : '¡Empate!';
  $('turn-title').textContent = title; $('turn-sub').textContent = '';
  tune(winner ? [523, 659, 784, 1047] : [440, 440, 349], 'square', 0.13, 0.12);
  setTimeout(() => {
    document.querySelector('.menu-title').textContent = title;
    document.querySelector('.menu-lead').textContent = winner ? 'Todos los pilotos del otro equipo terminaron fuera de sus cabinas.' : 'No quedó ningún piloto sentado.';
    document.querySelector('.menu-rules').hidden = true;
    $('btn-cpu').textContent = 'Otra vez: 1 jugador';
    $('btn-2p').textContent = 'Otra vez: 2 jugadores';
    $('menu').hidden = false;
  }, 2200);
}
