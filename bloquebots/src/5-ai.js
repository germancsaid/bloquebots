
// ---------- Rival de la computadora ----------
// Usa el mismo cálculo exacto que la mira del jugador: elige el arco más bajo
// que no choca con libros ni otros robots, y luego añade un poco de error humano.
function pathClear(from, v0, n, blockers) {
  const a = shotAccel(), p = from.clone(), v = v0.clone();
  for (let i = 1; i < n - 8; i++) {
    v.addScaledVector(a, FIXED_DT); p.addScaledVector(v, FIXED_DT);
    if (i % 3) continue;
    if (p.y < TABLE.top + 0.3) return false;
    for (const b of blockers) if (b.containsPoint(p)) return false;
  }
  return true;
}

function planCpuShot(robot) {
  const enemies = robots.filter((r) => r.alive && r.team !== robot.team);
  const target = enemies[Math.floor(Math.random() * enemies.length)];
  const tp = new THREE.Vector3().copy(target.die.body.position);
  const from = spawnPoint(robot);
  const blockers = [...things.filter((t) => t.kind === 'prop'),
    ...robots.filter((r) => r !== robot && r !== target).flatMap((r) => [r.die, ...r.blocks])]
    .map((t) => boxOf(t).expandByScalar(0.5));
  const range = feasibleRange(from, tp);
  let v = null;
  if (range) {
    for (let n = range[0]; n <= range[1] && !v; n += 3) {
      const cand = launchVelocity(from, tp, n);
      if (pathClear(from, cand, n, blockers)) v = cand;
    }
    if (!v) v = launchVelocity(from, tp, Math.round((range[0] + range[1]) / 2));
  } else {
    // Fuera de alcance: tira lo más lejos que puede en esa dirección
    const h = new THREE.Vector3(tp.x - from.x, 0, tp.z - from.z).normalize().multiplyScalar(SHOT_MAX * Math.SQRT1_2);
    v = h.setY(SHOT_MAX * Math.SQRT1_2);
  }
  return {
    target, phase: 'think', t: 0, inRange: !!range,
    yaw: Math.atan2(v.z, v.x) + rand(-2.2, 2.2) * DEG,
    pitch: Math.atan2(v.y, Math.hypot(v.x, v.z)) + rand(-1.2, 1.2) * DEG,
    power: clamp(((v.length() - SHOT_MIN) / (SHOT_MAX - SHOT_MIN)) * rand(0.96, 1.04), 0.02, 1),
    fromYaw: G.yaw, fromPitch: G.pitch,
  };
}

function updateCpu(dt) {
  const ai = G.ai;
  if (!ai || G.mode !== 'aim') return;
  ai.t += dt;
  if (ai.phase === 'think' && ai.t > 0.9) { ai.phase = 'aim'; ai.t = 0; ai.fromYaw = G.yaw; ai.fromPitch = G.pitch; }
  if (ai.phase === 'aim') {
    const k = Math.min(1, ai.t / 1.3), e = k * k * (3 - 2 * k);
    let d = ai.yaw - ai.fromYaw; d = Math.atan2(Math.sin(d), Math.cos(d));
    G.yaw = ai.fromYaw + d * e;
    G.pitch = ai.fromPitch + (ai.pitch - ai.fromPitch) * e;
    if (k >= 1) { ai.phase = 'charge'; ai.t = 0; G.charging = true; G.power = 0; }
  }
  if (ai.phase === 'charge') {
    G.power = Math.min(ai.power, G.power + dt / CHARGE_TIME);
    if (G.power >= ai.power) fire();
  }
}
