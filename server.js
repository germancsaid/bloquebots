// Servidor de Bloquebots: sirve el juego y conecta a los dos jugadores de cada sala.
// Uso: npm start   (o PORT=9000 npm start)
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT) || 8080;
const GAME = path.join(__dirname, 'preview.html');

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/ping') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('bloquebots'); }
  if (url === '/' || url === '/index.html' || url === '/preview.html') {
    return fs.readFile(GAME, (err, data) => {
      if (err) { res.writeHead(500); return res.end('Falta preview.html: ejecuta ./build.sh'); }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(data);
    });
  }
  res.writeHead(404); res.end('No encontrado');
});

// Salas: código de 4 letras -> { host, guest }
const rooms = new Map();
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
function newCode() {
  let code;
  do { code = Array.from({ length: 4 }, () => LETTERS[Math.floor(Math.random() * LETTERS.length)]).join(''); } while (rooms.has(code));
  return code;
}
const send = (ws, msg) => { if (ws && ws.readyState === 1) ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg)); };
function leave(ws) {
  const room = ws.room && rooms.get(ws.room);
  if (!room) return;
  const peer = room.host === ws ? room.guest : room.host;
  send(peer, { type: 'peer-left' });
  if (peer) peer.room = null;
  rooms.delete(ws.room);
  ws.room = null;
}

const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    const text = raw.toString();
    let msg;
    try { msg = JSON.parse(text); } catch { return; }
    if (msg.type === 'create') {
      leave(ws);
      const code = newCode();
      rooms.set(code, { host: ws, guest: null });
      ws.room = code;
      send(ws, { type: 'created', code });
      console.log(`Sala ${code} creada`);
    } else if (msg.type === 'join') {
      const code = String(msg.code || '').toUpperCase();
      const room = rooms.get(code);
      if (!room) return send(ws, { type: 'error', msg: `No existe la sala ${code}.` });
      if (room.guest) return send(ws, { type: 'error', msg: 'Esa sala ya está llena.' });
      leave(ws);
      room.guest = ws; ws.room = code;
      send(room.host, { type: 'peer-joined' });
      console.log(`Alguien se unió a la sala ${code}`);
    } else {
      // Todo lo demás se reenvía al otro jugador de la sala
      const room = ws.room && rooms.get(ws.room);
      if (room) send(room.host === ws ? room.guest : room.host, text);
    }
  });
  ws.on('close', () => leave(ws));
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\nEl puerto ${PORT} ya está en uso: seguramente Bloquebots ya está encendido en otra ventana.`);
    console.error(`Ciérralo (Ctrl+C en esa ventana) o usa otro puerto:  PORT=8081 npm start\n`);
    process.exit(1);
  }
  throw err;
});
wss.on('error', () => {});   // el error de puerto ya lo explica el servidor http

server.listen(PORT, '0.0.0.0', () => {
  const ips = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
  console.log('\nBloquebots está listo:');
  console.log(`  En este ordenador:   http://localhost:${PORT}`);
  for (const ip of ips) console.log(`  En tu red (Wi-Fi):   http://${ip}:${PORT}`);
  console.log('\nPara jugar desde otra red, en otra terminal:  npm run tunnel\n');
});
