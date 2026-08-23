const tg = window.Telegram?.WebApp;
if (tg) { tg.ready(); tg.expand(); }

const params = new URLSearchParams(location.search);
const roomId = params.get('room') || tg?.initDataUnsafe?.start_param || 'default';
const myName = tg?.initDataUnsafe?.user?.first_name || 'Игрок';

const canvas = document.getElementById('arena');
const ctx = canvas.getContext('2d');
function resize() { canvas.width = canvas.clientWidth; canvas.height = canvas.clientHeight; }
window.addEventListener('resize', resize);
resize(); setTimeout(resize, 300);
if (tg) tg.onEvent('viewportChanged', resize);

const statusEl = document.getElementById('status');
const nameEls = { 0: document.getElementById('name-0'), 1: document.getElementById('name-1') };
const hpBarEls = { 0: document.getElementById('hp-bar-0'), 1: document.getElementById('hp-bar-1') };
const weaponNameEl = document.getElementById('weapon-name');
const ammoCountEl = document.getElementById('ammo-count');
const hitFlash = document.getElementById('hit-flash');
const xrayFlash = document.getElementById('xray-flash');

const WEAPONS = {
  usp: { name: 'USP (с глушителем)', damage: 16, critChance: 0.15, critMult: 2.2, fireRate: 260, accuracy: 0.88, range: 480, ammoMax: 12, reloadMs: 1100 },
  deagle: { name: 'Дигл', damage: 30, critChance: 0.28, critMult: 2.4, fireRate: 600, accuracy: 0.72, range: 520, ammoMax: 7, reloadMs: 1500 },
};

let mySlot = null;
let players = {};
let bloodEffects = [], sparkEffects = [], dmgTexts = [], bodyStains = { 0: [], 1: [] }, groundStains = [];
let muzzleFlash = null;
let screenShake = 0;
let fightStartAt = 0, showFightBanner = 0;
let critBanner = 0;
let koSlot = null, koStart = 0;
let displayX = {};
let staggerPhase = { 0: 0, 1: 0 };

let socket = null, localEngine = null, isOffline = false;

// ---------- ЗВУК ----------
let audioCtx = null;
function ensureAudio() { if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)(); if (audioCtx.state === 'suspended') audioCtx.resume(); }
function playTone({ freq = 440, duration = 0.12, type = 'sine', volume = 0.2, slideTo = null }) {
  if (!audioCtx) return;
  const osc = audioCtx.createOscillator(); const gain = audioCtx.createGain();
  osc.type = type; osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, audioCtx.currentTime + duration);
  gain.gain.setValueAtTime(volume, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
  osc.connect(gain); gain.connect(audioCtx.destination);
  osc.start(); osc.stop(audioCtx.currentTime + duration);
}
function sndShotUsp() { playTone({ freq: 320, slideTo: 180, duration: 0.06, type: 'square', volume: 0.14 }); }
function sndShotDeagle() { playTone({ freq: 180, slideTo: 60, duration: 0.16, type: 'sawtooth', volume: 0.28 }); }
function sndHit() { playTone({ freq: 160, slideTo: 40, duration: 0.14, type: 'square', volume: 0.22 }); }
function sndCrit() { playTone({ freq: 700, slideTo: 200, duration: 0.3, type: 'sawtooth', volume: 0.25 }); }
function sndReload() { playTone({ freq: 300, duration: 0.08, type: 'triangle', volume: 0.15 }); }
function sndSwitch() { playTone({ freq: 500, slideTo: 700, duration: 0.08, type: 'sine', volume: 0.15 }); }
function sndFailed() { playTone({ freq: 180, duration: 0.1, type: 'triangle', volume: 0.12 }); }
function sndCountdownBeep() { playTone({ freq: 500, duration: 0.1, type: 'sine', volume: 0.2 }); }
function sndFightGo() { playTone({ freq: 300, slideTo: 900, duration: 0.3, type: 'sawtooth', volume: 0.22 }); }
function sndVictory() { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => playTone({ freq: f, duration: 0.25, type: 'triangle', volume: 0.2 }), i * 110)); }
function sndDefeat() { [400, 320, 240, 160].forEach((f, i) => setTimeout(() => playTone({ freq: f, duration: 0.3, type: 'sawtooth', volume: 0.18 }), i * 130)); }

function haptic(style) {
  try {
    if (style === 'notif') tg?.HapticFeedback?.notificationOccurred('success');
    else if (style === 'error') tg?.HapticFeedback?.notificationOccurred('error');
    else tg?.HapticFeedback?.impactOccurred(style || 'light');
  } catch (e) {}
}

function spawnBloodAt(x, y) { for (let i = 0; i < 14; i++) bloodEffects.push({ x, y, vx: (Math.random() - 0.5) * 5, vy: -Math.random() * 3, life: 30, maxLife: 30, size: Math.random() * 2.6 + 1.4 }); }
function spawnSparks(x, y, dir) { for (let i = 0; i < 8; i++) sparkEffects.push({ x, y, vx: dir * (Math.random() * 4 + 2), vy: (Math.random() - 0.5) * 4, life: 14, maxLife: 14, size: Math.random() * 2 + 1 }); }
function spawnDmgText(x, y, text, color) { dmgTexts.push({ x, y, text, color, life: 45, maxLife: 45 }); }
function addBodyStain(slot) { const arr = bodyStains[slot]; arr.push({ dx: (Math.random() - 0.5) * 24, dy: -40 + (Math.random() - 0.5) * 40, size: Math.random() * 3 + 2.5 }); if (arr.length > 40) arr.shift(); }
function addGroundStain(arenaX) { groundStains.push({ arenaX, size: Math.random() * 9 + 7, offset: (Math.random() - 0.5) * 22 }); if (groundStains.length > 60) groundStains.shift(); }

// =====================================================================
class MiniEmitter {
  constructor() { this.handlers = {}; }
  on(event, fn) { (this.handlers[event] = this.handlers[event] || []).push(fn); }
  emit(event, data) { (this.handlers[event] || []).forEach(fn => fn(data)); }
}

// =====================================================================
// ЛОКАЛЬНЫЙ "СЕРВЕР" ДЛЯ ИГРЫ ПРОТИВ БОТА
// =====================================================================
function createLocalServer(toClient, difficulty) {
  const ARENA_WIDTH = 800;
  const HITSTUN_MS = 150, STAGGER_MS = 700, BLEEDOUT_DMG = 2, BLEEDOUT_TICK_MS = 400, COUNTDOWN_MS = 3000, MIN_DIST = 40;

  function newPlayer(slot, name) {
    return { x: slot === 0 ? 150 : ARENA_WIDTH - 150, facing: slot === 0 ? 1 : -1, hp: 100, slot, name, weapon: 'usp', ammo: { usp: WEAPONS.usp.ammoMax, deagle: WEAPONS.deagle.ammoMax }, reloading: false, reloadEndAt: 0, lastShotAt: 0, staggered: false, staggerUntil: 0, downed: false, hitstunUntil: 0 };
  }

  const state = { players: { human: newPlayer(0, myName), bot: newPlayer(1, 'Бот') }, startAt: 0 };
  const DIFF = {
    easy: { reaction: [900, 1500], accMult: 0.65, moveErr: 0.5 },
    medium: { reaction: [550, 950], accMult: 0.9, moveErr: 0.2 },
    hard: { reaction: [250, 500], accMult: 1.15, moveErr: 0.05 },
  }[difficulty];

  function isDead(p) { return p.hp <= 0; }
  function inCountdown() { return state.startAt && Date.now() < state.startAt; }
  function inHitstun(p) { return p.hitstunUntil && Date.now() < p.hitstunUntil; }
  function clampX(x) { return Math.max(20, Math.min(ARENA_WIDTH - 20, x)); }
  function other(id) { return id === 'human' ? 'bot' : 'human'; }
  function resolveCollision(mover, opp) {
    if (opp.downed) return;
    const diff = mover.x - opp.x;
    if (Math.abs(diff) < MIN_DIST) mover.x = clampX(opp.x + MIN_DIST * (diff < 0 ? -1 : 1));
  }

  function move(id, dir) {
    const p = state.players[id];
    if (!p || inCountdown() || isDead(p) || p.downed || p.staggered || inHitstun(p)) return;
    p.x = clampX(p.x + dir * 8);
    const opp = state.players[other(id)];
    resolveCollision(p, opp);
    p.facing = opp.x > p.x ? 1 : -1;
    toClient.emit('state_update', state.players);
  }

  function switchWeapon(id) {
    const p = state.players[id];
    if (!p || isDead(p) || p.downed) return;
    p.weapon = p.weapon === 'usp' ? 'deagle' : 'usp';
    toClient.emit('state_update', state.players);
  }

  function fire(id) {
    const attacker = state.players[id];
    if (!attacker || inCountdown() || isDead(attacker) || attacker.downed || attacker.staggered || inHitstun(attacker)) return;
    const weapon = WEAPONS[attacker.weapon];
    const now = Date.now();

    if (attacker.reloading) { if (id === 'human') toClient.emit('fire_failed', { reason: 'reloading' }); return; }
    if (now - attacker.lastShotAt < weapon.fireRate) return;
    if (attacker.ammo[attacker.weapon] <= 0) {
      attacker.reloading = true; attacker.reloadEndAt = now + weapon.reloadMs;
      toClient.emit('reload_start', { slot: attacker.slot, weapon: attacker.weapon, ms: weapon.reloadMs });
      toClient.emit('state_update', state.players);
      return;
    }

    attacker.lastShotAt = now;
    attacker.ammo[attacker.weapon]--;
    const opponent = state.players[other(id)];
    toClient.emit('shot_fired', { slot: attacker.slot, weapon: attacker.weapon });

    let result = { hit: false };
    if (!isDead(opponent)) {
      const dist = Math.abs(opponent.x - attacker.x);
      if (dist <= weapon.range) {
        const falloff = Math.max(0.6, 1 - (dist / weapon.range) * 0.4);
        let hitChance = weapon.accuracy * falloff;
        if (id === 'bot') hitChance *= DIFF.accMult;
        hitChance = Math.min(0.98, hitChance);

        if (Math.random() < hitChance) {
          const isCrit = !opponent.downed && Math.random() < weapon.critChance;
          let damage;
          if (opponent.downed) damage = 999;
          else damage = isCrit ? Math.round(weapon.damage * weapon.critMult) : weapon.damage;
          opponent.hp = Math.max(0, opponent.hp - damage);
          result = { hit: true, isCrit, damage, downed: opponent.downed };
          if (!opponent.downed) opponent.hitstunUntil = now + HITSTUN_MS;

          if (isCrit && !isDead(opponent) && !opponent.downed) {
            opponent.staggered = true; opponent.staggerUntil = now + STAGGER_MS;
            const oppKey = other(id);
            setTimeout(() => {
              const op = state.players[oppKey];
              if (!op || isDead(op)) return;
              op.staggered = false; op.downed = true;
              toClient.emit('state_update', state.players);
            }, STAGGER_MS);
          }
        }
      }
    }

    toClient.emit('shot_result', { attackerSlot: attacker.slot, targetSlot: opponent.slot, ...result });
    toClient.emit('state_update', state.players);
    if (isDead(opponent)) toClient.emit('game_over', { winnerSlot: attacker.slot });
  }

  setInterval(() => {
    let changed = false;
    const now = Date.now();
    Object.values(state.players).forEach((p) => {
      if (p.reloading && p.reloadEndAt <= now) { p.ammo[p.weapon] = WEAPONS[p.weapon].ammoMax; p.reloading = false; changed = true; }
      if (p.downed && !isDead(p)) { p.hp = Math.max(0, p.hp - BLEEDOUT_DMG); changed = true; }
    });
    if (changed) {
      toClient.emit('state_update', state.players);
      Object.entries(state.players).forEach(([id, p]) => {
        if (isDead(p)) { const winId = other(id); toClient.emit('game_over', { winnerSlot: state.players[winId].slot }); }
      });
    }
  }, BLEEDOUT_TICK_MS);

  function start() {
    toClient.emit('joined', { slot: 0, players: state.players });
    setTimeout(() => {
      state.startAt = Date.now() + COUNTDOWN_MS;
      toClient.emit('start_game', { players: state.players, startAt: state.startAt });
      runBotAI();
    }, 50);
  }

  function runBotAI() {
    let nextActionAt = Date.now() + DIFF.reaction[0];
    let moveDir = 0, moveUntil = 0;

    setInterval(() => {
      const bot = state.players.bot, human = state.players.human;
      if (isDead(bot) || isDead(human) || inCountdown()) return;
      if (bot.downed || bot.staggered) return;

      if (human.downed) {
        if (Date.now() > nextActionAt) {
          fire('bot');
          nextActionAt = Date.now() + DIFF.reaction[0] * 0.6;
        }
        return;
      }

      const dist = Math.abs(human.x - bot.x);
      const dirToHuman = human.x > bot.x ? 1 : -1;

      if (Date.now() > moveUntil) {
        const preferredDist = bot.weapon === 'deagle' ? 300 : 200;
        if (dist > preferredDist + 60) moveDir = dirToHuman;
        else if (dist < preferredDist - 60) moveDir = -dirToHuman;
        else moveDir = Math.random() < DIFF.moveErr ? (Math.random() < 0.5 ? 1 : -1) : 0;
        moveUntil = Date.now() + 250 + Math.random() * 250;
      }
      move('bot', moveDir);

      if (bot.hp < 35 && Math.random() < 0.02) switchWeapon('bot');
      else if (bot.hp >= 35 && dist > 350 && bot.weapon === 'usp' && Math.random() < 0.01) switchWeapon('bot');

      if (Date.now() > nextActionAt) {
        const w = WEAPONS[bot.weapon];
        if (dist <= w.range && !bot.reloading) {
          fire('bot');
        }
        const [minR, maxR] = DIFF.reaction;
        nextActionAt = Date.now() + minR + Math.random() * (maxR - minR);
      }
    }, 100);
  }

  return {
    move: (dir) => move('human', dir),
    fire: () => fire('human'),
    switchWeapon: () => switchWeapon('human'),
    start,
  };
}

// =====================================================================
// ОНЛАЙН / ОФЛАЙН ПОДКЛЮЧЕНИЕ
// =====================================================================
const onlineCountEl = document.getElementById('online-count');
const menuOverlay = document.getElementById('menu-overlay');
const onlineBtn = document.getElementById('online-btn');
const diffButtons = { easy: document.getElementById('diff-easy'), medium: document.getElementById('diff-medium'), hard: document.getElementById('diff-hard') };

function applyNames() { Object.values(players).forEach(p => { if (nameEls[p.slot] && p.name) nameEls[p.slot].textContent = p.name; }); }

function attachHandlers(bus) {
  bus.on('online_count', (count) => { onlineCountEl.textContent = count; });

  bus.on('joined', (data) => {
    mySlot = data.slot; players = data.players;
    statusEl.textContent = isOffline ? '' : 'Ждём соперника...';
    applyNames(); updateHpBars(); updateWeaponHud();
  });

  bus.on('opponent_joined', (data) => { players = data.players; applyNames(); updateHpBars(); });

  bus.on('start_game', (data) => {
    players = data.players;
    fightStartAt = data.startAt || (Date.now() + 3000);
    statusEl.textContent = '';
    applyNames(); updateHpBars();
    let lastShown = null;
    const tick = setInterval(() => {
      const remain = Math.ceil((fightStartAt - Date.now()) / 1000);
      if (remain !== lastShown && remain > 0) { sndCountdownBeep(); lastShown = remain; }
      if (Date.now() >= fightStartAt) { sndFightGo(); haptic('medium'); showFightBanner = 60; clearInterval(tick); }
    }, 50);
  });

  bus.on('state_update', (p) => { players = p; updateHpBars(); updateWeaponHud(); });

  bus.on('shot_fired', ({ slot, weapon }) => {
    muzzleFlash = { slot, weapon, life: 6 };
    if (weapon === 'deagle') sndShotDeagle(); else sndShotUsp();
    if (slot === mySlot) haptic('light');
    screenShake = Math.max(screenShake, weapon === 'deagle' ? 6 : 3);
  });

  bus.on('reload_start', ({ slot }) => { sndReload(); if (slot === mySlot) haptic('light'); });

  bus.on('shot_result', ({ targetSlot, hit, isCrit, damage, downed }) => {
    if (!hit || targetSlot === null || targetSlot === undefined) return;
    sndHit();
    screenShake = Math.max(screenShake, isCrit ? 14 : 7);

    const target = Object.values(players).find(pl => pl.slot === targetSlot);
    if (target) {
      const scale = canvas.width / 800;
      const tx = target.x * scale, ty = canvas.height - (target.downed ? 30 : 130);
      spawnBloodAt(tx, ty);
      spawnSparks(tx, ty, -target.facing);
      spawnDmgText(tx, ty - 20, (downed ? 'ДОБИТ!' : (isCrit ? 'КРИТ -' : '-') + damage), isCrit ? '#ffcf6b' : '#ff6b6b');
      addBodyStain(targetSlot);
      addGroundStain(target.x);
    }

    if (isCrit) {
      sndCrit(); critBanner = 45;
      xrayFlash.style.opacity = '1';
      setTimeout(() => (xrayFlash.style.opacity = '0'), 130);
    }

    if (targetSlot === mySlot) {
      haptic(isCrit ? 'heavy' : 'medium');
      hitFlash.style.opacity = '1';
      setTimeout(() => (hitFlash.style.opacity = '0'), 120);
    } else haptic('light');
  });

  bus.on('fire_failed', ({ reason }) => {
    sndFailed();
    if (reason === 'reloading') {
      const old = statusEl.textContent;
      statusEl.textContent = 'Перезарядка...';
      setTimeout(() => { if (statusEl.textContent === 'Перезарядка...') statusEl.textContent = old === 'Перезарядка...' ? '' : old; }, 500);
    }
  });

  bus.on('room_full', () => { statusEl.textContent = 'Комната уже занята'; });
  bus.on('opponent_left', () => { statusEl.textContent = 'Соперник вышел из дуэли'; });

  bus.on('game_over', ({ winnerSlot }) => {
    const won = winnerSlot === mySlot;
    statusEl.textContent = won ? '🏆 Победа!' : '💀 Ты убит';
    koSlot = winnerSlot === 0 ? 1 : 0; koStart = Date.now();
    if (won) { sndVictory(); haptic('notif'); } else { sndDefeat(); haptic('error'); }
    setTimeout(() => {
      onlineBtn.textContent = '🌐 ЕЩЁ РАЗ (ОНЛАЙН)';
      Object.values(diffButtons).forEach(b => (b.style.display = 'none'));
      menuOverlay.style.display = 'flex';
    }, 2000);
  });
}

function startOnline() {
  ensureAudio();
  if (onlineBtn.textContent.includes('ЕЩЁ РАЗ')) { location.reload(); return; }
  menuOverlay.style.display = 'none';
  isOffline = false;
  socket = io();
  attachHandlers(socket);
  socket.emit('join_room', { roomId, name: myName });
}
function startBot(difficulty) {
  ensureAudio();
  menuOverlay.style.display = 'none';
  isOffline = true;
  const bus = new MiniEmitter();
  attachHandlers(bus);
  localEngine = createLocalServer(bus, difficulty);
  localEngine.start();
}

onlineBtn.addEventListener('click', startOnline);
diffButtons.easy.addEventListener('click', () => startBot('easy'));
diffButtons.medium.addEventListener('click', () => startBot('medium'));
diffButtons.hard.addEventListener('click', () => startBot('hard'));

function updateHpBars() {
  Object.values(players).forEach(p => { if (hpBarEls[p.slot]) hpBarEls[p.slot].style.width = Math.max(0, p.hp) + '%'; });
}
function updateWeaponHud() {
  if (mySlot === null) return;
  const me = Object.values(players).find(pl => pl.slot === mySlot);
  if (!me) return;
  const w = WEAPONS[me.weapon];
  weaponNameEl.textContent = w.name;
  ammoCountEl.textContent = me.reloading ? '...' : me.ammo[me.weapon];
  fireBtn.classList.toggle('btn-disabled', me.downed || me.staggered || me.reloading);
  switchBtn.classList.toggle('btn-disabled', me.downed);
}

// ---------- ФОН: ДИКИЙ ЗАПАД ----------
function drawBackground() {
  const w = canvas.width, h = canvas.height;
  const sky = ctx.createLinearGradient(0, 0, 0, h * 0.6);
  sky.addColorStop(0, '#e8a25a'); sky.addColorStop(0.5, '#d97b4a'); sky.addColorStop(1, '#a85038');
  ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h * 0.6);

  const sunX = w * 0.25, sunY = h * 0.18, sunR = Math.min(w, h) * 0.08;
  const glow = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, sunR * 2.6);
  glow.addColorStop(0, 'rgba(255,230,180,0.6)'); glow.addColorStop(1, 'rgba(255,230,180,0)');
  ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(sunX, sunY, sunR * 2.6, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fff2d0'; ctx.beginPath(); ctx.arc(sunX, sunY, sunR, 0, Math.PI * 2); ctx.fill();

  // мезы/скалы
  ctx.fillStyle = '#7a4530';
  ctx.beginPath(); ctx.moveTo(0, h * 0.5);
  ctx.lineTo(w * 0.1, h * 0.5); ctx.lineTo(w * 0.14, h * 0.36); ctx.lineTo(w * 0.26, h * 0.36);
  ctx.lineTo(w * 0.3, h * 0.5); ctx.lineTo(w * 0.55, h * 0.5); ctx.lineTo(w * 0.6, h * 0.42);
  ctx.lineTo(w * 0.72, h * 0.42); ctx.lineTo(w * 0.76, h * 0.5); ctx.lineTo(w, h * 0.5);
  ctx.lineTo(w, h * 0.6); ctx.lineTo(0, h * 0.6); ctx.closePath(); ctx.fill();

  // салун-силуэт
  ctx.fillStyle = '#3a2418';
  const saloonX = w * 0.82, saloonY = h * 0.5;
  ctx.fillRect(saloonX, saloonY - 40, 70, 40);
  ctx.fillRect(saloonX - 6, saloonY - 50, 82, 12);
  ctx.fillStyle = '#2a1810';
  ctx.fillRect(saloonX + 26, saloonY - 26, 18, 26);

  // земля
  const ground = ctx.createLinearGradient(0, h * 0.6, 0, h);
  ground.addColorStop(0, '#c9954f'); ground.addColorStop(0.3, '#a3703a'); ground.addColorStop(1, '#5c3d22');
  ctx.fillStyle = ground; ctx.fillRect(0, h * 0.6, w, h * 0.4);

  ctx.strokeStyle = 'rgba(0,0,0,0.1)'; ctx.lineWidth = 2;
  for (let i = 0; i < 5; i++) {
    const y = h * 0.65 + i * ((h - h * 0.65) / 5);
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y + Math.sin(i) * 5); ctx.stroke();
  }

  // кактусы
  ctx.fillStyle = '#3f6b3f';
  [w * 0.08, w * 0.92].forEach((cx, i) => {
    const cy = h * 0.58; const dir = i === 0 ? 1 : -1;
    ctx.fillRect(cx - 5, cy - 40, 10, 40);
    ctx.fillRect(cx - 5 + 12 * dir, cy - 26, 8, 20);
    ctx.fillRect(cx - 5 - 12 * dir, cy - 32, 8, 16);
  });

  // кровавые пятна на земле (стойкие)
  const scale = w / 800;
  groundStains.forEach(s => {
    const gx = s.arenaX * scale + s.offset;
    ctx.fillStyle = 'rgba(110,15,15,0.5)';
    ctx.beginPath(); ctx.ellipse(gx, h - 6, s.size, s.size * 0.35, 0, 0, Math.PI * 2); ctx.fill();
  });

  const vignette = ctx.createRadialGradient(w / 2, h / 2, h * 0.3, w / 2, h / 2, h);
  vignette.addColorStop(0, 'rgba(0,0,0,0)'); vignette.addColorStop(1, 'rgba(0,0,0,0.4)');
  ctx.fillStyle = vignette; ctx.fillRect(0, 0, w, h);
}

function drawDownedFighter(p, x) {
  const y = canvas.height - 24;
  const bodyColor = p.slot === 0 ? '#4a6b8a' : '#8a5a3a';
  const dir = p.facing;
  ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.beginPath(); ctx.ellipse(x, y + 2, 32, 8, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#241c18'; ctx.fillRect(x - 38 * dir, y - 9, 20 * dir, 8);
  ctx.fillStyle = bodyColor; ctx.fillRect(x - 18, y - 20, 38, 18);
  ctx.fillStyle = '#e8b88a'; ctx.beginPath(); ctx.arc(x + 28 * dir, y - 13, 11, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#4a3222'; ctx.beginPath(); ctx.arc(x + 28 * dir, y - 18, 9, Math.PI, Math.PI * 2); ctx.fill();
  bodyStains[p.slot].forEach(st => { ctx.fillStyle = 'rgba(130,15,15,0.55)'; ctx.beginPath(); ctx.arc(x + st.dx * 0.5, y - 10, st.size * 0.8, 0, Math.PI * 2); ctx.fill(); });
}

function drawFighter(p, renderX) {
  if (p.downed) { drawDownedFighter(p, renderX); return; }

  const x = renderX;
  let y = canvas.height - 100;
  const bodyColor = p.slot === 0 ? '#4a6b8a' : '#8a5a3a';
  const bodyShade = p.slot === 0 ? '#33495e' : '#5e3c26';
  const skin = '#e8b88a';

  const inKoFall = koSlot === p.slot && koStart && Date.now() - koStart < 700;
  const koProgress = inKoFall ? Math.min(1, (Date.now() - koStart) / 700) : 0;

  ctx.save();
  if (p.staggered) {
    staggerPhase[p.slot] += 0.35;
    const wobble = Math.sin(staggerPhase[p.slot]) * 10;
    ctx.translate(x, y); ctx.rotate((wobble * Math.PI) / 180); ctx.translate(-x, -y);
    y += Math.abs(Math.sin(staggerPhase[p.slot] * 1.3)) * 4;
  } else {
    staggerPhase[p.slot] *= 0.5;
  }
  if (inKoFall) { ctx.translate(x, y); ctx.rotate((koProgress * 85 * p.facing * Math.PI) / 180); ctx.translate(-x, -y); }

  ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.ellipse(x, y + 4, 20, 6, 0, 0, Math.PI * 2); ctx.fill();

  // шляпа-плащ силуэт
  ctx.fillStyle = bodyShade;
  ctx.beginPath();
  ctx.moveTo(x - 12 * p.facing, y - 60);
  ctx.quadraticCurveTo(x - 24 * p.facing, y - 34, x - 15 * p.facing, y - 2);
  ctx.lineTo(x - 4 * p.facing, y - 2); ctx.closePath(); ctx.fill();

  // ноги
  ctx.fillStyle = '#2a1e16';
  ctx.fillRect(x - 11, y - 24, 8, 24); ctx.fillRect(x + 3, y - 24, 8, 24);
  ctx.fillStyle = '#100c0a'; ctx.fillRect(x - 12, y - 3, 10, 4); ctx.fillRect(x + 2, y - 3, 10, 4);

  // тело
  const bodyGrad = ctx.createLinearGradient(x - 15, y - 60, x + 15, y - 20);
  bodyGrad.addColorStop(0, bodyColor); bodyGrad.addColorStop(1, bodyShade);
  ctx.fillStyle = bodyGrad; ctx.fillRect(x - 15, y - 60, 30, 40);
  ctx.fillStyle = '#1a1410'; ctx.fillRect(x - 15, y - 24, 30, 5);

  // задняя рука
  ctx.fillStyle = bodyShade; ctx.fillRect(x - 17 * p.facing, y - 56, 6, 24);

  // голова + шляпа
  ctx.fillStyle = skin; ctx.beginPath(); ctx.arc(x, y - 74, 13, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#3a2a1c';
  ctx.beginPath(); ctx.ellipse(x, y - 84, 17, 5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(x, y - 90, 8, Math.PI, 0); ctx.fill();
  ctx.fillStyle = '#1a1410';
  const eyeShift = p.facing * 3;
  ctx.beginPath(); ctx.arc(eyeShift + x - 2, y - 74, 1.4, 0, Math.PI * 2); ctx.arc(eyeShift + x + 2, y - 74, 1.4, 0, Math.PI * 2); ctx.fill();

  // передняя рука + пистолет
  ctx.save();
  ctx.translate(x + 13 * p.facing, y - 52);
  ctx.fillStyle = bodyColor; ctx.fillRect(0, 0, p.facing * 22, 6);
  ctx.fillStyle = '#2a2a2a'; ctx.fillRect(p.facing * 20, -2, p.facing * (p.weapon === 'deagle' ? 14 : 10), 5);
  if (p.weapon === 'usp') { ctx.fillStyle = '#555'; ctx.fillRect(p.facing * 28, -3, p.facing * 6, 7); }
  ctx.restore();

  // дульная вспышка
  if (muzzleFlash && muzzleFlash.slot === p.slot && muzzleFlash.life > 0) {
    const mx = x + (p.weapon === 'deagle' ? 48 : 42) * p.facing, my = y - 52;
    ctx.fillStyle = 'rgba(255,220,120,0.9)';
    ctx.beginPath(); ctx.arc(mx, my, muzzleFlash.weapon === 'deagle' ? 10 : 6, 0, Math.PI * 2); ctx.fill();
  }

  bodyStains[p.slot].forEach(st => {
    ctx.fillStyle = 'rgba(140,15,15,0.5)';
    ctx.beginPath(); ctx.arc(x + st.dx, y + st.dy, st.size, 0, Math.PI * 2); ctx.fill();
  });

  ctx.restore();
}

function drawCountdown() {
  const w = canvas.width, h = canvas.height;
  if (fightStartAt) {
    const remainMs = fightStartAt - Date.now();
    if (remainMs > 0) {
      const secLeft = Math.ceil(remainMs / 1000);
      const scale = 1 + ((remainMs % 1000) / 1000) * 0.5;
      ctx.save(); ctx.globalAlpha = 0.85; ctx.translate(w / 2, h * 0.4); ctx.scale(scale, scale);
      ctx.font = 'bold 64px -apple-system, sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#ffe066';
      ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 10;
      ctx.fillText(secLeft, 0, 0); ctx.restore();
    } else if (showFightBanner > 0) {
      ctx.save(); ctx.globalAlpha = Math.min(showFightBanner / 20, 1); ctx.translate(w / 2, h * 0.4);
      ctx.font = 'bold 46px -apple-system, sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#ff6b6b';
      ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 12;
      ctx.fillText('ОГОНЬ!', 0, 0); ctx.restore();
      showFightBanner--;
    }
  }
  if (critBanner > 0) {
    ctx.save(); ctx.globalAlpha = Math.min(critBanner / 20, 1); ctx.translate(w / 2, h * 0.22);
    ctx.font = 'bold 30px -apple-system, sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#9fd6ff';
    ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 8;
    ctx.fillText('💀 КРИТИЧЕСКИЙ!', 0, 0); ctx.restore();
    critBanner--;
  }
}

function draw() {
  const w = canvas.width, h = canvas.height;
  ctx.save();
  if (screenShake > 0) { ctx.translate((Math.random() - 0.5) * screenShake, (Math.random() - 0.5) * screenShake); screenShake *= 0.82; if (screenShake < 0.3) screenShake = 0; }
  ctx.clearRect(-20, -20, w + 40, h + 40);
  drawBackground();

  const scale = w / 800;
  Object.values(players).forEach((p) => {
    if (displayX[p.slot] === undefined) displayX[p.slot] = p.x * scale;
    displayX[p.slot] += (p.x * scale - displayX[p.slot]) * 0.3;
    drawFighter(p, displayX[p.slot]);
  });

  if (muzzleFlash && muzzleFlash.life > 0) muzzleFlash.life--; else muzzleFlash = null;

  sparkEffects.forEach(s => {
    const alpha = Math.max(s.life / s.maxLife, 0);
    ctx.strokeStyle = `rgba(255,224,120,${alpha})`; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(s.x - s.vx * 1.5, s.y - s.vy * 1.5); ctx.stroke();
    s.x += s.vx; s.y += s.vy; s.vy += 0.15; s.life--;
  });
  sparkEffects = sparkEffects.filter(s => s.life > 0);

  bloodEffects.forEach(b => {
    const alpha = Math.max(b.life / b.maxLife, 0);
    ctx.fillStyle = `rgba(161,29,29,${alpha})`;
    ctx.beginPath(); ctx.arc(b.x, b.y, b.size, 0, Math.PI * 2); ctx.fill();
    b.x += b.vx; b.y += b.vy; b.vy += 0.22; b.life--;
  });
  bloodEffects = bloodEffects.filter(b => b.life > 0);

  dmgTexts.forEach(t => {
    ctx.save(); ctx.globalAlpha = Math.max(t.life / t.maxLife, 0);
    ctx.fillStyle = t.color; ctx.font = 'bold 14px -apple-system, sans-serif'; ctx.textAlign = 'center';
    ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = 3;
    ctx.fillText(t.text, t.x, t.y); ctx.restore();
    t.y -= 0.6; t.life--;
  });
  dmgTexts = dmgTexts.filter(t => t.life > 0);

  drawCountdown();
  ctx.restore();
  requestAnimationFrame(draw);
}
draw();

const zone = document.getElementById('joystick-zone');
const knob = document.getElementById('joystick-knob');
const fireBtn = document.getElementById('fire-btn');
const switchBtn = document.getElementById('switch-btn');
let dragging = false, moveInterval = null, currentDir = 0;

function setKnob(dx) { const max = 45; const c = Math.max(-max, Math.min(max, dx)); knob.style.left = 51 + c + 'px'; knob.style.top = '51px'; }
function startMoveLoop() {
  if (moveInterval) return;
  moveInterval = setInterval(() => {
    if (currentDir === 0) return;
    if (isOffline) localEngine?.move(currentDir); else socket?.emit('move', { dir: currentDir });
  }, 50);
}
function stopMoveLoop() { clearInterval(moveInterval); moveInterval = null; }
function handleStart() { dragging = true; startMoveLoop(); }
function handleMove(e) {
  if (!dragging) return;
  const touch = e.touches ? e.touches[0] : e;
  const rect = zone.getBoundingClientRect();
  const dx = touch.clientX - (rect.left + rect.width / 2);
  setKnob(dx);
  currentDir = dx > 15 ? 1 : dx < -15 ? -1 : 0;
}
function handleEnd() { dragging = false; currentDir = 0; knob.style.left = '51px'; stopMoveLoop(); }

zone.addEventListener('touchstart', handleStart);
zone.addEventListener('touchmove', handleMove);
zone.addEventListener('touchend', handleEnd);
zone.addEventListener('mousedown', handleStart);
window.addEventListener('mousemove', handleMove);
window.addEventListener('mouseup', handleEnd);

function doFire(e) { e.preventDefault(); if (isOffline) localEngine?.fire(); else socket?.emit('fire'); }
function doSwitch(e) { e.preventDefault(); sndSwitch(); if (isOffline) localEngine?.switchWeapon(); else socket?.emit('switch_weapon'); }

fireBtn.addEventListener('touchstart', doFire);
fireBtn.addEventListener('mousedown', doFire);
switchBtn.addEventListener('touchstart', doSwitch);
switchBtn.addEventListener('mousedown', doSwitch);
