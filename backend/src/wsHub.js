// ============================================================
// wsHub.js — /ws/market : broadcasts compact JSON updates to every
// connected frontend (any of your PWAs). Frontend never touches Dhan
// directly, never sees credentials — only this processed JSON.
// ============================================================

const WebSocket = require('ws');

let wss = null;
const clients = new Set();

function attach(server) {
  wss = new WebSocket.Server({ server, path: '/ws/market' });
  wss.on('connection', (ws) => {
    clients.add(ws);
    ws.on('close', () => clients.delete(ws));
    ws.on('error', () => clients.delete(ws));
    ws.send(JSON.stringify({ type: 'hello', ts: Date.now() }));
  });
  console.log('[wsHub] /ws/market attached');
}

function broadcast(msg) {
  const data = JSON.stringify(msg);
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) {
      try { ws.send(data); } catch (e) { /* drop silently, client will reconnect */ }
    }
  }
}

function clientCount() { return clients.size; }

module.exports = { attach, broadcast, clientCount };
