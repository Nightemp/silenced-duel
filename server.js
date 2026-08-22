const express = require('express');
const http = require('http');
const path = require('path');
const { WebSocketServer } = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.static(path.join(__dirname, 'public')));

const STATE = { played: 0 };
let queue = null; // ws, ожидающий соперника

function broadcastStats() {
  const payload = JSON.stringify({ type: 'stats', online: wss.clients.size, played: STATE.played });
  wss.clients.forEach(c => { if (c.readyState === 1) c.send(payload); });
}
function send(ws, obj) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
}

wss.on('connection', ws => {
  ws.opponent = null;
  ws.ready = false;
  broadcastStats();

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {
      case 'game_played': // счётчик для дуэлей с ботом
        STATE.played += 1;
        broadcastStats();
        break;

      case 'find_duel':
        if (queue && queue.readyState === 1 && queue !== ws) {
          const opponent = queue;
          queue = null;
          ws.opponent = opponent;
          opponent.opponent = ws;
          ws.ready = false;
          opponent.ready = false;
          send(ws, { type: 'duel_found' });
          send(opponent, { type: 'duel_found' });
        } else {
          queue = ws;
        }
        break;

      case 'cancel_find':
        if (queue === ws) queue = null;
        break;

      case 'ready':
        ws.ready = true;
        if (ws.opponent && ws.opponent.ready) {
          send(ws, { type: 'duel_start' });
          send(ws.opponent, { type: 'duel_start' });
        }
        break;

      case 'shot':
        if (ws.opponent) send(ws.opponent, { type: 'opponent_shot' });
        break;

      case 'hit':
        if (ws.opponent) send(ws.opponent, { type: 'you_were_hit', part: msg.part });
        if (msg.part === 'head' || msg.part === 'torso') {
          STATE.played += 1;
          broadcastStats();
          if (ws.opponent) ws.opponent.opponent = null;
          ws.opponent = null;
        }
        break;
    }
  });

  ws.on('close', () => {
    if (queue === ws) queue = null;
    if (ws.opponent) {
      send(ws.opponent, { type: 'opponent_left' });
      ws.opponent.opponent = null;
    }
    broadcastStats();
  });
});

setInterval(broadcastStats, 15000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`SILENCED duel server running on port ${PORT}`);
});
