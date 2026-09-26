
// ---------- Elegir robots antes de la partida ----------
let THUMBS = null;
const picker = { team: 'red', slots: [] };

function openPicker() {
  if (!THUMBS) THUMBS = makeThumbs();
  $('menu').hidden = true;
  $('picker').hidden = false;
  pickerFor('red');
}

let mapChoice = 'escritorio';
function renderMaps() {
  $('map-row').hidden = G.net ? NET.role !== 'host' : picker.team !== 'red';
  $('maps').innerHTML = [...Object.entries(MAPS), ['azar', { name: 'Al azar', desc: 'Sorpresa: uno cualquiera.' }]].map(([k, m]) =>
    `<button class="map-btn" type="button" data-map="${k}" aria-pressed="${k === mapChoice}"><span class="design-name">${m.name}</span><span class="design-desc">${m.desc}</span></button>`).join('');
}
$('maps').addEventListener('click', (e) => {
  const b = e.target.closest('[data-map]');
  if (!b) return;
  mapChoice = b.dataset.map; knock(2, 1.2, 1); renderMaps();
});

function pickerFor(team) {
  picker.team = team;
  picker.slots = [];
  renderMaps();
  $('picker-title').textContent = G.vsCPU ? 'Elige tus robots' : `Equipo ${TEAM_NAMES[team]}: elige tus robots`;
  $('picker-title').style.color = team === 'red' ? '#ff8a7e' : '#8fb8ff';
  renderPicker();
}

const pips = (n) => `<span class="pips">${[1, 2, 3, 4, 5].map((i) => `<i class="${i <= n ? 'on' : ''}"></i>`).join('')}</span>`;

function renderPicker() {
  const thumbs = (THUMBS && THUMBS[picker.team]) || {};
  $('designs').innerHTML = Object.entries(DESIGNS).map(([key, d]) => `
    <button class="design" type="button" data-key="${key}" aria-label="Elegir ${esc(d.name)}">
      ${thumbs[key] ? `<img src="${thumbs[key]}" alt="">` : ''}
      <span class="design-name">${esc(d.name)}${d.custom ? ' <span class="tag">Tuyo</span>' : ''}</span>
      <span class="design-desc">${d.desc}</span>
      <span class="stat"><span class="label">Altura</span>${pips(d.altura)}</span>
      ${d.custom ? `<span class="stat"><span class="label">Bloques</span><span>${d.count}</span></span>` : `<span class="stat"><span class="label">Aguante</span>${pips(d.aguante)}</span>`}
    </button>`).join('');
  $('slots').innerHTML = [0, 1].map((i) => picker.slots[i]
    ? `<button class="slot filled" type="button" data-slot="${i}" aria-label="Quitar ${esc(DESIGNS[picker.slots[i]].name)}">${i + 1}. ${esc(DESIGNS[picker.slots[i]].name)} ✕</button>`
    : `<span class="slot">${i + 1}. Sin elegir</span>`).join('');
  $('picker-ok').disabled = picker.slots.length < 2;
}

$('designs').addEventListener('click', (e) => {
  const btn = e.target.closest('.design');
  if (!btn || picker.slots.length >= 2) return;
  picker.slots.push(btn.dataset.key);
  knock(3, 1, 1);
  renderPicker();
});
$('slots').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-slot]');
  if (!btn) return;
  picker.slots.splice(Number(btn.dataset.slot), 1);
  renderPicker();
});
$('picker-back').addEventListener('click', () => { $('picker').hidden = true; $('menu').hidden = false; });
$('picker-ok').addEventListener('click', () => {
  G.picks[picker.team] = [...picker.slots];
  if (G.net) { netPicksDone(); return; }
  if (!G.vsCPU && picker.team === 'red') { pickerFor('blue'); return; }
  if (G.vsCPU) {
    const keys = Object.keys(DESIGNS).filter((k) => !DESIGNS[k].custom);
    G.picks.blue = [keys[Math.floor(Math.random() * keys.length)], keys[Math.floor(Math.random() * keys.length)]];
  }
  const keys = Object.keys(MAPS);
  G.map = mapChoice === 'azar' ? keys[Math.floor(Math.random() * keys.length)] : mapChoice;
  $('picker').hidden = true;
  beginMatch();
});
