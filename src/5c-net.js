
// ---------- Multijugador en red (Guerra total 1 contra 1) ----------
// Quien crea la partida (anfitrión) calcula toda la física. El invitado le manda sus controles
// y recibe, 30 veces por segundo, dónde está cada pieza. Así los dos ven exactamente lo mismo.
// Al terminar, los dos siguen en la misma sala y pueden pedir la revancha tantas veces como quieran.
const NET = {
  ws: null, role: null, code: '', side: 'red', ready: false,
  input: { fwd: 0, side: 0, turn: 0 }, remoteInput: { fwd: 0, side: 0, turn: 0 }, fireQueue: [],
  myPicks: null, peerPicks: null, events: [], known: new Set(), sendT: 0, fullT: 0, lastFire: 0, lastKnock: 0,
  stage: null,   // lobby · pick (eligiendo) · wait (esperando al rival) · play · result · build (en el taller)
  score: { me: 0, rival: 0 }, played: false, peerAgain: false, peerGone: '', lastSlots: [],
};
const r3 = (v) => Math.round(v * 1000) / 1000, r4 = (v) => Math.round(v * 10000) / 10000;
const other = (team) => (team === 'red' ? 'blue' : 'red');

function netSend(msg) { if (NET.ws && NET.ws.readyState === 1) NET.ws.send(JSON.stringify(msg)); }
function netEvent(e) {
  if (!G.net || NET.role !== 'host' || G.mode !== 'war') return;
  if (e.e === 'k') { const now = performance.now(); if (now - NET.lastKnock < 30) return; NET.lastKnock = now; }
  NET.events.push(e);
}
function lobbyStatus(msg) { $('lobby-status').textContent = msg; }

// ¿Está el juego servido por nuestro servidor? (en el link publicado no lo está)
fetch('/ping').then((r) => r.ok && r.text()).then((t) => { if (t === 'bloquebots') $('btn-net').hidden = false; }).catch(() => {});

function netConnect() {
  return new Promise((resolve, reject) => {
    if (NET.ws && NET.ws.readyState === 1) return resolve();
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    NET.ws = ws;
    ws.onopen = () => { ws.wasOpen = true; resolve(); };
    ws.onerror = () => reject(new Error('sin conexión'));
    ws.onclose = () => {
      if (NET.ws !== ws) return;   // una conexión vieja que ya cerramos nosotros
      NET.ws = null;
      if (ws.wasOpen) netPeerLeft('Se perdió la conexión con el servidor.');
    };
    ws.onmessage = (ev) => { try { netMessage(JSON.parse(ev.data)); } catch (err) { console.error(err); } };
  });
}

function netAbort(msg) {
  endWalk(); if (G.remote) endWalk(G.remote);
  G.net = false; G.remote = null; G.mode = 'over'; G.firing = false;
  NET.stage = null; NET.role = null;
  toast(msg, 2500);
  for (const id of ['picker', 'lobby', 'result']) $(id).hidden = true;
  setTimeout(() => { $('menu').hidden = false; }, 1500);
}

// Salir de la sala: el rival recibe el aviso y tú vuelves al menú
function netLeave() {
  NET.stage = null; NET.role = null; NET.myPicks = NET.peerPicks = null;
  G.net = false; G.remote = null;
  const ws = NET.ws;
  NET.ws = null;
  if (ws) ws.close();
  for (const id of ['lobby', 'picker', 'result']) $(id).hidden = true;
  $('menu').hidden = false;
}

// El rival (o el servidor) ya no está: esta sala se terminó
function netPeerLeft(msg) {
  const stage = NET.stage;
  if (!stage) return;
  if (stage === 'play') { netAbort(msg); return; }
  NET.role = null; NET.myPicks = NET.peerPicks = null; NET.peerGone = msg;
  if (stage === 'result') { renderResult(); return; }
  if (stage === 'build') { status(`${msg} Al salir del taller volverás a la sala.`); return; }
  netToLobby(msg);
}
function netToLobby(msg) {
  G.net = false; NET.stage = 'lobby'; NET.peerGone = '';
  for (const id of ['picker', 'result']) $(id).hidden = true;
  $('lobby').hidden = false; $('lobby-start').hidden = false; $('lobby-wait').hidden = true;
  lobbyStatus(`${msg} Crea otra partida o únete a otra.`);
}

// ---------- Sala ----------
function openLobby() {
  NET.stage = 'lobby';
  $('menu').hidden = true; $('lobby').hidden = false;
  $('lobby-start').hidden = false; $('lobby-wait').hidden = true;
  lobbyStatus('Conectando con el servidor…');
  netConnect().then(() => lobbyStatus('Crea una partida o únete con el código que te den.'))
    .catch(() => lobbyStatus('No se pudo conectar con el servidor. ¿Está encendido?'));
}
for (const b of document.querySelectorAll('#lobby [data-side]')) b.addEventListener('click', () => {
  NET.side = b.dataset.side;
  for (const o of document.querySelectorAll('#lobby [data-side]')) o.setAttribute('aria-pressed', String(o === b));
});
$('btn-net').addEventListener('click', () => { ensureAudio(); openLobby(); });
$('net-back').addEventListener('click', netLeave);
$('net-create').addEventListener('click', async () => {
  try { await netConnect(); } catch { lobbyStatus('No se pudo conectar con el servidor.'); return; }
  NET.role = 'host'; netSend({ type: 'create' });
});
$('net-join').addEventListener('click', async () => {
  const code = $('net-code').value.trim().toUpperCase();
  if (code.length !== 4) { lobbyStatus('El código tiene 4 letras.'); return; }
  try { await netConnect(); } catch { lobbyStatus('No se pudo conectar con el servidor.'); return; }
  NET.role = 'guest'; netSend({ type: 'join', code });
});
$('net-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('net-join').click(); });

// Elegir robots: al entrar en la sala, o en cada revancha (con los robots de la vez anterior ya puestos)
function netToPicker(team, rematch = false) {
  G.net = true; G.war = true; G.vsCPU = false; G.myTeam = team;
  NET.myPicks = null; NET.stage = 'pick';
  if (!rematch) Object.assign(NET, { peerPicks: null, score: { me: 0, rival: 0 }, played: false, peerAgain: false, peerGone: '', lastSlots: [] });
  $('lobby').hidden = true; $('result').hidden = true;
  if (!THUMBS) THUMBS = makeThumbs();
  $('picker').hidden = false;
  pickerFor(team, rematch ? NET.lastSlots.filter((k) => DESIGNS[k]) : []);
  $('picker-title').textContent = rematch ? `Revancha: elige tus robots (equipo ${TEAM_NAMES[team]})` : `Eres el equipo ${TEAM_NAMES[team]}: elige tus robots`;
  $('picker-back').textContent = rematch ? 'Volver' : 'Salir de la sala';
}
function netPickerNote() {
  $('picker-note').textContent = !G.net ? '' : NET.peerPicks ? 'Tu rival ya eligió: en cuanto pulses Listo empieza la partida.'
    : NET.peerAgain ? 'Tu rival también está eligiendo robots…' : '';
}
function netNotes() {
  if (NET.stage === 'result') renderResult();
  if (NET.stage === 'pick') netPickerNote();
}

// Cada robot elegido viaja como diseño completo (así también funcionan los del Taller)
const pickData = (keys) => keys.map((k) => ({ design: (DESIGNS[k] || NET_DESIGNS[k]).make() }));

function netPicksDone() {
  NET.lastSlots = [...picker.slots];
  NET.myPicks = pickData(G.picks[G.myTeam]);
  NET.stage = 'wait';
  $('picker').hidden = true; $('lobby').hidden = false;
  $('lobby-start').hidden = true; $('lobby-wait').hidden = false;
  if (NET.role === 'guest') { netSend({ type: 'picks', picks: NET.myPicks }); lobbyStatus('Listo. Esperando a que el anfitrión elija…'); }
  else { lobbyStatus('Esperando a que tu rival elija sus robots…'); netMaybeStart(); }
}

function netMaybeStart() {
  if (NET.role !== 'host' || !NET.myPicks || !NET.peerPicks) return;
  const keys = Object.keys(MAPS);
  const setup = {
    type: 'setup', map: mapChoice === 'azar' ? keys[Math.floor(Math.random() * keys.length)] : mapChoice,
    zs: Math.random() < 0.5 ? 1 : -1,
    picks: { [G.myTeam]: NET.myPicks, [other(G.myTeam)]: NET.peerPicks },
  };
  netSend(setup);
  netStart(setup);
}

function netStart(setup) {
  for (const team of ['red', 'blue']) setup.picks[team].forEach((p, i) => {
    NET_DESIGNS[`n_${team}_${i}`] = { name: p.design.name, make: () => p.design };
  });
  G.picks = { red: ['n_red_0', 'n_red_1'], blue: ['n_blue_0', 'n_blue_1'] };
  G.map = setup.map; G.zs = setup.zs;
  G.net = true; G.war = true; G.vsCPU = false;
  NET.stage = 'play'; NET.peerAgain = false; NET.peerPicks = null;
  for (const id of ['lobby', 'picker', 'menu', 'result']) $(id).hidden = true;
  setupMatch();
  G.shot = null; G.overview = false;
  startWar();
  NET.known = new Set(things.map((t) => t.id));
  NET.events = []; NET.fireQueue = []; NET.sendT = 0; NET.fullT = 99;
  if (NET.role === 'host') {
    const rt = other(G.myTeam);
    G.remote = { active: robots.find((r) => r.team === rt && r.alive), walkGroup: null, walkPose: null, walkV: { vx: 0, vz: 0 }, walkW: 0,
      walking: false, walkLock: 0, walkLeft: WALK_BUDGET, moved: false, walkPhase: 0, blockers: [] };
  } else G.remote = null;
}

// ---------- Fin de la partida y revancha ----------
function netGameOver(winner, title) {
  NET.stage = 'result'; NET.played = true;
  NET.myPicks = NET.peerPicks = null; NET.peerAgain = false; NET.fireQueue = [];
  if (winner === G.myTeam) NET.score.me++; else if (winner) NET.score.rival++;
  G.remote = null;
  $('result-title').textContent = title;
  // Un momento para ver cómo quedó la mesa antes de la pantalla de revancha
  setTimeout(() => { if (NET.stage === 'result') netShowResult(); }, 2200);
}
function netShowResult() {
  NET.stage = 'result';
  $('picker').hidden = true; $('result').hidden = false;
  renderResult();
}
function renderResult() {
  const s = NET.score, gone = NET.peerGone;
  $('result-score').textContent = `Tú ${s.me} – ${s.rival} Rival`;
  $('btn-rematch').hidden = $('btn-rematch-build').hidden = !!gone;
  $('result-status').textContent = gone || (NET.peerPicks ? 'Tu rival ya eligió sus robots: ¡te espera para la revancha!'
    : NET.peerAgain ? 'Tu rival quiere la revancha y está eligiendo robots.'
    : '¿Otra? Vuelve a elegir robots o crea uno nuevo en el Taller.');
}
function netRematch() {
  if (NET.peerGone) return;
  netSend({ type: 'again' });   // solo avisa al rival: la partida empieza cuando los dos eligen
  netToPicker(G.myTeam, true);
}
$('btn-rematch').addEventListener('click', () => { ensureAudio(); netRematch(); });
$('btn-rematch-build').addEventListener('click', () => { ensureAudio(); netRematch(); openBuilder('picker'); });
$('btn-leave').addEventListener('click', netLeave);

function netMessage(m) {
  switch (m.type) {
    case 'created':
      NET.code = m.code;
      $('lobby-start').hidden = true; $('lobby-wait').hidden = false;
      $('net-code-show').textContent = m.code;
      lobbyStatus(`Dale este código a tu rival: ${m.code}. Esperando a que se una…`);
      break;
    case 'error': lobbyStatus(m.msg); NET.role = null; break;
    case 'peer-joined':   // (anfitrión) llegó el rival: le decimos su equipo
      netSend({ type: 'lobby', hostTeam: NET.side });
      netToPicker(NET.side);
      break;
    case 'lobby':         // (invitado) el anfitrión eligió equipo: nos toca el otro
      netToPicker(other(m.hostTeam));
      break;
    case 'picks': NET.peerPicks = m.picks; netMaybeStart(); netNotes(); break;
    case 'again': NET.peerAgain = true; netNotes(); break;
    case 'setup': netStart(m); break;
    case 'snap': netGuestSnap(m); break;
    case 'in': NET.remoteInput = { fwd: m.f, side: m.s, turn: m.t }; netRemoteActive(m.a); break;
    case 'fire': NET.fireQueue.push(m); break;
    case 'over': if (G.net && G.mode === 'war') { endWalk(); gameOver(m.winner); } break;
    case 'peer-left': netPeerLeft('Tu rival se fue de la sala.'); break;
  }
}

// ---------- Anfitrión: mueve el robot del rival y le envía el estado ----------
function netRemoteActive(i) {
  const R = G.remote, r = robots[i];
  if (!R || !r || !r.alive || r.team === G.myTeam || r === R.active) return;
  endWalk(R); R.active = r;
}

function netHostWar(dt) {
  const R = G.remote;
  if (!R) return;
  if (!R.active || !R.active.alive) { endWalk(R); R.active = robots.find((r) => r.team === other(G.myTeam) && r.alive) || R.active; }
  if (!R.active) return;
  const inp = NET.remoteInput;
  R.walkLeft = WALK_BUDGET; R.moved = false; R.walkLock = Math.max(0, R.walkLock - dt);
  if (R.walkLock > 0) updateWalk(dt, 0, 0, 0, R); else updateWalk(dt, inp.fwd, inp.side, inp.turn, R);
  if (!R.walking) endWalk(R);
  if (R.walkGroup && threatNear(R.active, R.walkGroup)) { endWalk(R); R.walkLock = 0.6; }
  for (const f of NET.fireQueue) {
    netRemoteActive(f.a);
    const r = R.active;
    if (!readyToFire(r)) continue;
    // Ráfaga hacia el punto que eligió el rival (o directa, si apuntó al aire)
    const P = new THREE.Vector3(...f.p), arc = clamp(f.arc, 0, 1);
    startBurst(r, () => {
      const from = spawnPoint(r), sol = (!f.air && solveShot(from, P, arc)) || directShot(from, P);
      return { v: sol.v, from };
    }, WAR_RELOAD);
  }
  NET.fireQueue = [];
}

function netHostTick(dt) {
  NET.sendT += dt; NET.fullT += dt;
  if (NET.sendT < 1 / 30) return;
  NET.sendT = 0;
  const full = NET.fullT > 1;
  if (full) NET.fullT = 0;
  const ev = NET.events; NET.events = [];
  const ids = new Set();
  for (const t of things) { ids.add(t.id); if (!NET.known.has(t.id)) ev.push({ e: 'add', id: t.id, kind: t.kind }); }
  for (const id of NET.known) if (!ids.has(id)) ev.push({ e: 'rm', id });
  NET.known = ids;
  const b = [];
  for (const t of things) {
    if (!full && t.body.sleepState === CANNON.Body.SLEEPING) continue;
    const p = t.body.position, q = t.body.quaternion;
    b.push([t.id, r3(p.x), r3(p.y), r3(p.z), r4(q.x), r4(q.y), r4(q.z), r4(q.w)]);
  }
  netSend({
    type: 'snap', b, ev,
    r: robots.map((r) => [r.alive ? 1 : 0, r3(r.cool || 0), r4(r.yaw || 0), r.burst || 0]),
    ra: G.remote ? robots.indexOf(G.remote.active) : -1,
    w: [r3(G.wind.x), r3(G.wind.z), r3(G.wind.strength), r3(G.wind.angle)],
  });
}

// ---------- Invitado: aplica lo que llega y envía sus controles ----------
function netGuestSnap(m) {
  if (!G.net || G.mode !== 'war') return;
  const byId = new Map(things.map((t) => [t.id, t]));
  for (const e of m.ev) {
    if (e.e === 'add' && !byId.has(e.id)) {
      const t = makeBlock(new THREE.Vector3(0, -50, 0), new THREE.Quaternion(), MAT.wood, e.kind, SHOT_MASS);
      t.id = e.id; t.fresh = true; byId.set(e.id, t);
    } else if (e.e === 'rm' && byId.has(e.id)) { removeThing(byId.get(e.id)); byId.delete(e.id); }
    else if (e.e === 'k') { if (e.d === 1) knock(e.v * 0.7, 1.9, 1.6); else if (e.d === 2) knock(e.v * 0.8, 0.6, 0.7); else knock(e.v, 1, 1); }
    else if (e.e === 'w') whoosh(e.v);
    else if (e.e === 't') toast(e.text, e.ms || 1600, e.color || '');
    else if (e.e === 'fall') tune([392, 330, 262], 'triangle', 0.14, 0.14);
  }
  for (const [id, x, y, z, qx, qy, qz, qw] of m.b) {
    const t = byId.get(id);
    if (!t) continue;
    t.body.position.set(x, y, z); t.body.quaternion.set(qx, qy, qz, qw);
    t.netP = (t.netP || new THREE.Vector3()).set(x, y, z);
    t.netQ = (t.netQ || new THREE.Quaternion()).set(qx, qy, qz, qw);
    if (t.fresh) { syncMesh(t); t.fresh = false; }
  }
  let changed = false;
  m.r.forEach(([alive, cool, yaw, burst], i) => {
    const r = robots[i];
    if (!r) return;
    if (r.alive !== !!alive) { r.alive = !!alive; changed = true; }
    r.cool = cool; r.yaw = yaw; r.burst = burst || 0;
  });
  if (G.active && !G.active.alive && robots[m.ra] && robots[m.ra].alive) { G.active = robots[m.ra]; G.target = null; G.air = null; G.camFollow = 0; changed = true; }
  if (changed) renderTeams();
  const [wx, wz, s, a] = m.w;
  G.wind = { x: wx, z: wz, strength: s, angle: a }; fanAngleTarget = a;
}

function netGuestFrame(dt) {
  // Movimiento suave entre un paquete y el siguiente
  const k = 1 - Math.exp(-dt * 18);
  for (const t of things) if (t.netP) { t.mesh.position.lerp(t.netP, k); t.mesh.quaternion.slerp(t.netQ, k); }
  NET.sendT += dt;
  if (NET.sendT < 1 / 20) return;
  NET.sendT = 0;
  netSend({ type: 'in', f: NET.input.fwd, s: NET.input.side, t: NET.input.turn, a: robots.indexOf(G.active) });
  // Mantener el clic: dispara una ráfaga cada vez que el robot recarga
  if (G.firing && readyToFire(G.active) && G.aim && performance.now() - NET.lastFire > 500) netSendFire();
}

function netSendFire() {
  const p = G.target || G.air;
  if (!p || !G.active) return;
  NET.lastFire = performance.now();
  netSend({ type: 'fire', p: [r3(p.x), r3(p.y), r3(p.z)], arc: r3(G.arc), air: G.target ? 0 : 1, a: robots.indexOf(G.active) });
}
