// Сервер: раздаёт клиент игры, держит счётчики "игроков онлайн" и
// "сыграно дуэлей", а также матчмейкинг для честных PvP-дуэлей 1×1.
// Игра против ботов считается полностью на клиенте (см. game.js) —
// сервер для неё нужен только чтобы засчитать "сыграно" в общую статистику.
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

const STATE = { played: 0, leaderboard: new Map() }; // name -> wins
let queue = null; // ws, ожидающий соперника для онлайн-дуэли

function topLeaderboard() {
  return [...STATE.leaderboard.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, wins]) => ({ name, wins }));
}

function broadcastStats() {
  const payload = JSON.stringify({
    type: 'stats',
    online: wss.clients.size,
    played: STATE.played,
    leaderboard: topLeaderboard(),
  });
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
      // ----- статистика для игр против бота (только счётчик) -----
      case 'game_played':
        STATE.played += 1;
        broadcastStats();
        break;

      // Победа (и против бота, и в онлайне) — засчитывается в общий топ-10.
      // Имя не проверяется на уникальность специально: это казуальный
      // лидерборд, а не система аккаунтов.
      case 'report_win': {
        const rawName = typeof msg.name === 'string' ? msg.name.trim().slice(0, 24) : '';
        const name = rawName || 'Безымянный';
        STATE.leaderboard.set(name, (STATE.leaderboard.get(name) || 0) + 1);
        broadcastStats();
        break;
      }

      // ----- матчмейкинг PvP -----
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
        if (ws.opponent) send(ws.opponent, { type: 'you_were_hit', part: msg.part, weapon: msg.weapon });
        break;

      // Клиент, у которого юнит умер (мгновенно или от кровопотери),
      // сообщает об этом явно — так матч закрывается в правильный момент.
      case 'duel_over':
        STATE.played += 1;
        broadcastStats();
        if (ws.opponent) ws.opponent.opponent = null;
        ws.opponent = null;
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

// периодический пинг — держит счётчик "онлайн" точным даже при обрывах связи
setInterval(broadcastStats, 15000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`SILENCED duel server running on port ${PORT}`);
});