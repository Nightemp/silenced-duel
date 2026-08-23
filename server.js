const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Telegraf } = require('telegraf');
const path = require('path');
const crypto = require('crypto');

const BOT_TOKEN = process.env.BOT_TOKEN;
const PUBLIC_URL = process.env.PUBLIC_URL;

if (!BOT_TOKEN || !PUBLIC_URL) {
  console.error('Задайте BOT_TOKEN и PUBLIC_URL в переменных окружения');
  process.exit(1);
}

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const io = new Server(server);

const rooms = new Map();
let totalGamesPlayed = 0;

const ARENA_HALF = 9; // граница арены по X и Z (метры)
const ARM_BREAK_HITS = 3;
const TORSO_DMG = 34; // ~3 попадания в торс = смерть
const STAGGER_MS = 480;

function newPlayerState(slot, nickname) {
  return {
    slot,
    nickname: (nickname || 'Игрок').slice(0, 16),
    x: slot === 0 ? -4 : 4,
    z: 0,
    yaw: slot === 0 ? Math.PI / 2 : -Math.PI / 2,
    headHp: 100,
    torsoHp: 100,
    armHits: 0,
    armBroken: false,
    down: false,
    dead: false,
  };
}

function isAlive(p) {
  return p.headHp > 0 && p.torsoHp > 0 && !p.dead;
}

function createRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, { players: {}, order: [], finished: false });
  }
  return rooms.get(roomId);
}

function broadcastStats() {
  io.emit('stats_update', {
    online: io.engine.clientsCount,
    totalGames: totalGamesPlayed,
  });
}

io.on('connection', (socket) => {
  broadcastStats();

  socket.on('get_stats', () => {
    socket.emit('stats_update', {
      online: io.engine.clientsCount,
      totalGames: totalGamesPlayed,
    });
  });

  socket.on('join_room', ({ roomId, nickname }) => {
    const room = createRoom(roomId);
    if (room.order.length >= 2) {
      socket.emit('room_full');
      return;
    }
    const slot = room.order.length;
    room.players[socket.id] = newPlayerState(slot, nickname);
    room.order.push(socket.id);
    socket.join(roomId);
    socket.data.roomId = roomId;

    socket.emit('joined', { slot, players: room.players });
    socket.to(roomId).emit('opponent_joined', { players: room.players });

    if (room.order.length === 2) {
      room.finished = false;
      io.to(roomId).emit('start_game', { players: room.players });
    }
  });

  // клиент сам двигает себя (доверенное движение — маленький проект, не античит-система)
  socket.on('move', ({ x, z, yaw }) => {
    const roomId = socket.data.roomId;
    const room = rooms.get(roomId);
    if (!room || room.finished) return;
    const p = room.players[socket.id];
    if (!p || !isAlive(p)) return;
    p.x = Math.max(-ARENA_HALF, Math.min(ARENA_HALF, x));
    p.z = Math.max(-ARENA_HALF, Math.min(ARENA_HALF, z));
    p.yaw = yaw;
    socket.to(roomId).emit('opponent_move', { slot: p.slot, x: p.x, z: p.z, yaw: p.yaw });
  });

  // выстрел: клиент сам определил, попал ли и в какую часть тела (упрощение для небольшого проекта)
  socket.on('shoot', ({ hit, part, point }) => {
    const roomId = socket.data.roomId;
    const room = rooms.get(roomId);
    if (!room || room.finished) return;
    const shooter = room.players[socket.id];
    if (!shooter || !isAlive(shooter)) return;

    io.to(roomId).emit('shot_fired', { slot: shooter.slot });

    if (!hit) return;
    const targetId = room.order.find((id) => id !== socket.id);
    if (!targetId) return;
    const target = room.players[targetId];
    if (!target || !isAlive(target)) return;

    let died = false;
    let armBrokeNow = false;
    let downNow = false;

    if (part === 'head') {
      target.headHp = 0;
      died = true;
    } else if (part === 'torso') {
      target.torsoHp = Math.max(0, target.torsoHp - TORSO_DMG);
      if (target.torsoHp <= 0) died = true;
    } else if (part === 'arm') {
      target.armHits += 1;
      if (target.armHits >= ARM_BREAK_HITS && !target.armBroken) {
        target.armBroken = true;
        armBrokeNow = true;
      }
    } else if (part === 'leg') {
      if (!target.down) {
        target.down = true;
        downNow = true;
      }
    }

    if (died) target.dead = true;

    io.to(roomId).emit('player_hit', {
      targetSlot: target.slot,
      part,
      point,
      armBroken: target.armBroken,
      down: target.down,
      dead: target.dead,
      staggerMs: STAGGER_MS,
    });

    if (died) {
      room.finished = true;
      totalGamesPlayed += 1;
      io.to(roomId).emit('game_over', { winnerSlot: shooter.slot });
      broadcastStats();
    }
  });

  socket.on('disconnect', () => {
    const roomId = socket.data.roomId;
    const room = rooms.get(roomId);
    if (room) {
      delete room.players[socket.id];
      room.order = room.order.filter((id) => id !== socket.id);
      io.to(roomId).emit('opponent_left');
      if (room.order.length === 0) {
        rooms.delete(roomId);
      }
    }
    broadcastStats();
  });
});

const bot = new Telegraf(BOT_TOKEN);

bot.start((ctx) => {
  const payload = ctx.startPayload;
  const roomId = payload || crypto.randomBytes(4).toString('hex');
  const gameUrl = `${PUBLIC_URL}/?room=${roomId}`;
  const inviteLink = `https://t.me/${ctx.botInfo.username}?start=${roomId}`;

  ctx.reply(
    payload
      ? '🔫 Ты присоединяешься к дуэли. Жми кнопку ниже.'
      : `🔫 Дуэль создана! Отправь другу ссылку:\n${inviteLink}\n\nКогда друг перейдёт по ней — начинайте.`,
    {
      reply_markup: {
        inline_keyboard: [[{ text: '🔫 Выйти на дуэль', web_app: { url: gameUrl } }]],
      },
    }
  );
});

bot.launch();
console.log('Бот запущен');

server.listen(process.env.PORT || 3000, () => {
  console.log('Сервер дуэли запущен');
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
