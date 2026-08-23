const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { Telegraf } = require('telegraf');
const path = require('path');
const crypto = require('crypto');

const BOT_TOKEN = (process.env.BOT_TOKEN || '').trim();
const PUBLIC_URL = (process.env.PUBLIC_URL || '').trim().replace(/\/+$/, '');

if (!BOT_TOKEN || !PUBLIC_URL) {
  console.error('Задайте BOT_TOKEN и PUBLIC_URL в переменных окружения');
  process.exit(1);
}

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const io = new Server(server);

const ARENA_WIDTH = 800;
const rooms = new Map();

const WEAPONS = {
  usp: { name: 'USP (с глушителем)', damage: 16, critChance: 0.15, critMult: 2.2, fireRate: 260, accuracy: 0.88, range: 480, ammoMax: 12, reloadMs: 1100 },
  deagle: { name: 'Дигл', damage: 30, critChance: 0.28, critMult: 2.4, fireRate: 600, accuracy: 0.72, range: 520, ammoMax: 7, reloadMs: 1500 },
};

const HITSTUN_MS = 150;
const STAGGER_MS = 700;
const BLEEDOUT_DMG = 2;
const BLEEDOUT_TICK_MS = 400;
const TICK_MS = 200;
const COUNTDOWN_MS = 3000;
const MIN_DIST = 40;

function newPlayerState(slot, name) {
  return {
    x: slot === 0 ? 150 : ARENA_WIDTH - 150,
    facing: slot === 0 ? 1 : -1,
    hp: 100,
    slot,
    name: (name || 'Игрок').slice(0, 16),
    weapon: 'usp',
    ammo: { usp: WEAPONS.usp.ammoMax, deagle: WEAPONS.deagle.ammoMax },
    reloading: false,
    reloadEndAt: 0,
    lastShotAt: 0,
    staggered: false,
    staggerUntil: 0,
    downed: false,
    hitstunUntil: 0,
  };
}

function createRoom(roomId) {
  if (!rooms.has(roomId)) rooms.set(roomId, { players: {}, order: [], startAt: 0 });
  return rooms.get(roomId);
}

function broadcastOnlineCount() { io.emit('online_count', io.engine.clientsCount); }
function isDead(p) { return p.hp <= 0; }
function inCountdown(room) { return room.startAt && Date.now() < room.startAt; }
function inHitstun(p) { return p.hitstunUntil && Date.now() < p.hitstunUntil; }
function clampX(x) { return Math.max(20, Math.min(ARENA_WIDTH - 20, x)); }

function resolveCollision(mover, opponent) {
  if (!opponent || opponent.downed) return;
  const diff = mover.x - opponent.x;
  if (Math.abs(diff) < MIN_DIST) mover.x = clampX(opponent.x + MIN_DIST * (diff < 0 ? -1 : 1));
}

io.on('connection', (socket) => {
  broadcastOnlineCount();

  socket.on('join_room', ({ roomId, name }) => {
    const room = createRoom(roomId);
    if (room.order.length >= 2) { socket.emit('room_full'); return; }
    const slot = room.order.length;
    room.players[socket.id] = newPlayerState(slot, name);
    room.order.push(socket.id);
    socket.join(roomId);
    socket.data.roomId = roomId;

    socket.emit('joined', { slot, players: room.players });
    socket.to(roomId).emit('opponent_joined', { slot, players: room.players });

    if (room.order.length === 2) {
      room.startAt = Date.now() + COUNTDOWN_MS;
      io.to(roomId).emit('start_game', { players: room.players, startAt: room.startAt });
    }
  });

  socket.on('move', ({ dir }) => {
    const roomId = socket.data.roomId;
    const room = rooms.get(roomId);
    if (!room || !room.players[socket.id] || inCountdown(room)) return;
    const p = room.players[socket.id];
    if (isDead(p) || p.downed || p.staggered || inHitstun(p)) return;

    p.x = clampX(p.x + dir * 8);
    const opponentId = room.order.find((id) => id !== socket.id);
    const opponent = opponentId ? room.players[opponentId] : null;
    if (opponent) {
      resolveCollision(p, opponent);
      p.facing = opponent.x > p.x ? 1 : -1;
    }
    io.to(roomId).emit('state_update', room.players);
  });

  socket.on('switch_weapon', () => {
    const roomId = socket.data.roomId;
    const room = rooms.get(roomId);
    if (!room || !room.players[socket.id]) return;
    const p = room.players[socket.id];
    if (isDead(p) || p.downed) return;
    p.weapon = p.weapon === 'usp' ? 'deagle' : 'usp';
    io.to(roomId).emit('state_update', room.players);
  });

  socket.on('fire', () => {
    const roomId = socket.data.roomId;
    const room = rooms.get(roomId);
    if (!room || !room.players[socket.id] || inCountdown(room)) return;
    const attacker = room.players[socket.id];
    if (isDead(attacker) || attacker.downed || attacker.staggered || inHitstun(attacker)) return;

    const weapon = WEAPONS[attacker.weapon];
    const now = Date.now();

    if (attacker.reloading) { socket.emit('fire_failed', { reason: 'reloading' }); return; }
    if (now - attacker.lastShotAt < weapon.fireRate) return;
    if (attacker.ammo[attacker.weapon] <= 0) {
      attacker.reloading = true;
      attacker.reloadEndAt = now + weapon.reloadMs;
      io.to(roomId).emit('reload_start', { slot: attacker.slot, weapon: attacker.weapon, ms: weapon.reloadMs });
      io.to(roomId).emit('state_update', room.players);
      return;
    }

    attacker.lastShotAt = now;
    attacker.ammo[attacker.weapon]--;

    const opponentId = room.order.find((id) => id !== socket.id);
    const opponent = opponentId ? room.players[opponentId] : null;

    io.to(roomId).emit('shot_fired', { slot: attacker.slot, weapon: attacker.weapon });

    let result = { hit: false };
    if (opponent && !isDead(opponent)) {
      const dist = Math.abs(opponent.x - attacker.x);
      if (dist <= weapon.range) {
        const falloff = Math.max(0.6, 1 - (dist / weapon.range) * 0.4);
        const hitChance = weapon.accuracy * falloff;

        if (Math.random() < hitChance) {
          const isCrit = !opponent.downed && Math.random() < weapon.critChance;
          let damage;
          if (opponent.downed) {
            damage = 999; // добивание лежащего
          } else {
            damage = isCrit ? Math.round(weapon.damage * weapon.critMult) : weapon.damage;
          }
          opponent.hp = Math.max(0, opponent.hp - damage);
          result = { hit: true, isCrit, damage, downed: opponent.downed };

          if (!opponent.downed) opponent.hitstunUntil = now + HITSTUN_MS;

          if (isCrit && !isDead(opponent) && !opponent.downed) {
            opponent.staggered = true;
            opponent.staggerUntil = now + STAGGER_MS;
            const oppId = opponentId;
            setTimeout(() => {
              const stillRoom = rooms.get(roomId);
              if (!stillRoom || !stillRoom.players[oppId]) return;
              const op = stillRoom.players[oppId];
              if (!isDead(op)) { op.staggered = false; op.downed = true; }
              io.to(roomId).emit('state_update', stillRoom.players);
            }, STAGGER_MS);
          }
        }
      }
    }

    io.to(roomId).emit('shot_result', { attackerSlot: attacker.slot, targetSlot: opponent ? opponent.slot : null, ...result });
    io.to(roomId).emit('state_update', room.players);

    if (opponent && isDead(opponent)) io.to(roomId).emit('game_over', { winnerSlot: attacker.slot });
  });

  socket.on('disconnect', () => {
    const roomId = socket.data.roomId;
    const room = rooms.get(roomId);
    if (room) {
      delete room.players[socket.id];
      room.order = room.order.filter((id) => id !== socket.id);
      io.to(roomId).emit('opponent_left');
      if (room.order.length === 0) rooms.delete(roomId);
    }
    broadcastOnlineCount();
  });
});

setInterval(() => {
  rooms.forEach((room, roomId) => {
    if (room.order.length < 2) return;
    let changed = false;
    const now = Date.now();

    Object.values(room.players).forEach((p) => {
      if (p.reloading && p.reloadEndAt <= now) {
        p.ammo[p.weapon] = WEAPONS[p.weapon].ammoMax;
        p.reloading = false;
        changed = true;
      }
      if (p.downed && !isDead(p)) {
        p.hp = Math.max(0, p.hp - BLEEDOUT_DMG);
        changed = true;
      }
    });

    if (changed) {
      io.to(roomId).emit('state_update', room.players);
      Object.entries(room.players).forEach(([id, p]) => {
        if (isDead(p)) {
          const winnerId = room.order.find((oid) => oid !== id);
          if (winnerId) io.to(roomId).emit('game_over', { winnerSlot: room.players[winnerId].slot });
        }
      });
    }
  });
}, BLEEDOUT_TICK_MS);

const bot = new Telegraf(BOT_TOKEN);

bot.start((ctx) => {
  const payload = ctx.startPayload;
  const roomId = payload || crypto.randomBytes(4).toString('hex');
  const gameUrl = `${PUBLIC_URL}/?room=${roomId}`;
  const inviteLink = `https://t.me/${ctx.botInfo.username}?start=${roomId}`;

  ctx.reply(
    payload
      ? '🤠 Ты присоединяешься к дуэли! Жми кнопку ниже.'
      : `🤠 Дуэль создана! Отправь другу ссылку-приглашение:\n${inviteLink}\n\nИли играй один против бота прямо в игре.`,
    { reply_markup: { inline_keyboard: [[{ text: '🔫 Открыть арену', web_app: { url: gameUrl } }]] } }
  );
});

bot.catch((err, ctx) => {
  console.error(`Ошибка Telegraf при обработке update ${ctx.updateType}:`, err.message || err);
});

bot.launch().catch((err) => {
  console.error('Ошибка запуска бота (bot.launch):', err.message || err);
});

server.listen(process.env.PORT || 3000, () => {
  console.log('Сервер West Duel запущен');
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));