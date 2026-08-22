// Простой сервер: раздаёт клиент игры и держит счётчики
// "игроков онлайн" (по открытым WebSocket-соединениям)
// и "сыграно дуэлей" (общий счётчик в памяти процесса).
//
// Примечание: счётчик "сыграно" хранится в памяти процесса.
// Render на бесплатном плане может перезапускать процесс —
// для долговременного хранения замените STATE на запись в
// файл /data (Render Disk) или во внешнюю БД (например Redis).

const express = require('express');
const http = require('http');
const path = require('path');
const { WebSocketServer } = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.static(path.join(__dirname, 'public')));

const STATE = {
  played: 0,
};

function broadcastStats() {
  const payload = JSON.stringify({
    type: 'stats',
    online: wss.clients.size,
    played: STATE.played,
  });
  wss.clients.forEach(client => {
    if (client.readyState === 1) client.send(payload);
  });
}

wss.on('connection', ws => {
  broadcastStats();

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg.type === 'game_played') {
      STATE.played += 1;
      broadcastStats();
    }
  });

  ws.on('close', () => broadcastStats());
});

// периодический пинг — держит счётчик "онлайн" точным даже при обрывах связи
setInterval(broadcastStats, 15000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`SILENCED duel server running on port ${PORT}`);
});
