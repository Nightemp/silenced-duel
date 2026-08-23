import * as THREE from 'three';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

const tg = window.Telegram?.WebApp;
if (tg) { tg.ready(); tg.expand(); }

const params = new URLSearchParams(location.search);
const roomId = params.get('room') || tg?.initDataUnsafe?.start_param || crypto.randomUUID().slice(0, 8);

// ЗАМЕНИ на юзернейм своего бота (без @), чтобы кнопка "Пригласить друга" работала
const BOT_USERNAME = 'YOUR_BOT_USERNAME';

// ---------- DOM ----------
const wrap = document.getElementById('canvas-wrap');
const hitMarker = document.getElementById('hit-marker');
const xrayPopup = document.getElementById('xray-popup');
const xrayLabel = document.getElementById('xray-label');
const ammoEl = document.getElementById('ammo');
const statusEl = document.getElementById('status');
const fireBtn = document.getElementById('fire-btn');
const koOverlay = document.getElementById('ko-overlay');
const koText = document.getElementById('ko-text');
const koSub = document.getElementById('ko-sub');

// ---------- THREE.JS СЦЕНА ----------
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x05060a, 0.045);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 200);
camera.position.set(-4, 1.65, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
wrap.appendChild(renderer.domElement);

const labelRenderer = new CSS2DRenderer();
labelRenderer.setSize(window.innerWidth, window.innerHeight);
labelRenderer.domElement.style.position = 'absolute';
labelRenderer.domElement.style.top = '0';
labelRenderer.domElement.style.pointerEvents = 'none';
wrap.appendChild(labelRenderer.domElement);

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  labelRenderer.setSize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', onResize);
setTimeout(onResize, 300);
if (tg) tg.onEvent('viewportChanged', onResize);

// ---------- ОСВЕЩЕНИЕ / АТМОСФЕРА ----------
scene.add(new THREE.AmbientLight(0x33344a, 0.7));
const moon = new THREE.DirectionalLight(0x8fa6ff, 0.5);
moon.position.set(-10, 20, 5);
scene.add(moon);

function addLamp(x, z) {
  const lamp = new THREE.PointLight(0xffcf8a, 12, 14, 2);
  lamp.position.set(x, 3.4, z);
  scene.add(lamp);
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.06, 3.4, 8),
    new THREE.MeshStandardMaterial({ color: 0x1a1a1a })
  );
  pole.position.set(x, 1.7, z);
  scene.add(pole);
}
addLamp(-6, -6);
addLamp(6, 6);
addLamp(6, -6);
addLamp(-6, 6);

// ---------- АРЕНА ----------
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(40, 40),
  new THREE.MeshStandardMaterial({ color: 0x1c1d22, roughness: 0.95 })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const wallMat = new THREE.MeshStandardMaterial({ color: 0x14151a, roughness: 1 });
[[0, -10, 20, 1], [0, 10, 20, 1], [-10, 0, 1, 20], [10, 0, 1, 20]].forEach(([x, z, w, d]) => {
  const wallGeo = new THREE.BoxGeometry(w, 4, d);
  const wallMesh = new THREE.Mesh(wallGeo, wallMat);
  wallMesh.position.set(x, 2, z);
  scene.add(wallMesh);
});

function addCrate(x, z) {
  const crate = new THREE.Mesh(
    new THREE.BoxGeometry(1.2, 1.2, 1.2),
    new THREE.MeshStandardMaterial({ color: 0x3a2c1c, roughness: 0.9 })
  );
  crate.position.set(x, 0.6, z);
  crate.castShadow = true;
  scene.add(crate);
}
addCrate(2, 2);
addCrate(-2.5, -1.5);
addCrate(0, -3);

// ---------- ОРУЖИЕ (вид от первого лица, с глушителем) ----------
const gunGroup = new THREE.Group();
const gunMat = new THREE.MeshStandardMaterial({ color: 0x232326, metalness: 0.6, roughness: 0.35 });
const body = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.09, 0.24), gunMat);
const grip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.13, 0.07), gunMat);
grip.position.set(0, -0.1, 0.06);
grip.rotation.x = 0.25;
const suppressor = new THREE.Mesh(
  new THREE.CylinderGeometry(0.018, 0.018, 0.22, 10),
  new THREE.MeshStandardMaterial({ color: 0x111114, metalness: 0.7, roughness: 0.3 })
);
suppressor.rotation.z = Math.PI / 2;
suppressor.position.set(0, 0.01, -0.28);
gunGroup.add(body, grip, suppressor);
gunGroup.position.set(0.18, -0.16, -0.35);
camera.add(gunGroup);
scene.add(camera);

const muzzleFlash = new THREE.PointLight(0xfff4c2, 0, 4, 2);
muzzleFlash.position.set(0.18, -0.14, -0.62);
camera.add(muzzleFlash);

// ---------- МОДЕЛЬ БОЙЦА ----------
function buildFighter(color) {
  const rig = new THREE.Group();

  const skin = 0xd9a97a;
  const clothMat = new THREE.MeshStandardMaterial({ color, roughness: 0.85 });
  const skinMat = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.9 });

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.5, 4, 8), clothMat);
  torso.position.y = 1.2;
  torso.castShadow = true;
  torso.userData.part = 'torso';
  rig.add(torso);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 16), skinMat);
  head.position.y = 1.68;
  head.castShadow = true;
  head.userData.part = 'head';
  rig.add(head);

  const legGroup = new THREE.Group();
  legGroup.position.y = 0.9;
  const legL = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.55, 4, 8), clothMat);
  legL.position.set(-0.11, -0.45, 0);
  legL.castShadow = true;
  legL.userData.part = 'leg';
  const legR = legL.clone();
  legR.position.x = 0.11;
  legR.userData.part = 'leg';
  legGroup.add(legL, legR);
  rig.add(legGroup);

  const armL = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.45, 4, 8), clothMat);
  armL.position.set(-0.3, 1.25, 0);
  armL.rotation.z = 0.15;
  armL.castShadow = true;
  armL.userData.part = 'arm';
  const armR = armL.clone();
  armR.position.x = 0.3;
  armR.rotation.z = -0.15;
  armR.userData.part = 'arm';
  rig.add(armL, armR);

  rig.userData.parts = { torso, head, armL, armR, legL, legR };
  return rig;
}

const opponentColors = [0x4a7c59, 0x7c4a4a];
const rigs = {}; // slot -> rig group
const labels = {}; // slot -> CSS2DObject

let mySlot = null;
let players = {};
let myArmBroken = false;
let myDown = false;
let dead = false;
let finished = false;

// ---------- РЕНТГЕН-ХИТМАРКЕР ----------
let xrayTimer = null;
function showXray(part) {
  document.querySelectorAll('#xray-figure .zone').forEach((z) => z.classList.remove('hit'));
  const el = document.getElementById('xray-' + part);
  if (el) el.classList.add('hit');
  const names = { head: 'ГОЛОВА', torso: 'ТОРС', arm: 'РУКА', leg: 'НОГА' };
  xrayLabel.textContent = names[part] || part;
  xrayPopup.classList.add('show');
  clearTimeout(xrayTimer);
  xrayTimer = setTimeout(() => xrayPopup.classList.remove('show'), 900);
}

function showHitMarker() {
  hitMarker.classList.add('show');
  setTimeout(() => hitMarker.classList.remove('show'), 130);
}

// ---------- КРОВЬ ----------
const bloodParticles = [];
const bloodMat = new THREE.MeshBasicMaterial({ color: 0x9e0e1c });
function spawnBlood(point, big) {
  const count = big ? 46 : 26;
  for (let i = 0; i < count; i++) {
    const size = 0.02 + Math.random() * (big ? 0.05 : 0.035);
    const p = new THREE.Mesh(new THREE.SphereGeometry(size, 5, 5), bloodMat);
    p.position.copy(point);
    scene.add(p);
    bloodParticles.push({
      mesh: p,
      vel: new THREE.Vector3(
        (Math.random() - 0.5) * (big ? 4.5 : 3),
        Math.random() * (big ? 4 : 2.5) + 1,
        (Math.random() - 0.5) * (big ? 4.5 : 3)
      ),
      life: 1,
    });
  }
  // лужа/декаль на полу
  const decal = new THREE.Mesh(
    new THREE.CircleGeometry(0.1 + Math.random() * (big ? 0.25 : 0.15), 10),
    new THREE.MeshBasicMaterial({ color: 0x6e0a16, transparent: true, opacity: 0.85 })
  );
  decal.rotation.x = -Math.PI / 2;
  decal.position.set(point.x, 0.01, point.z);
  scene.add(decal);
  if (bloodDecals.length > 60) {
    const old = bloodDecals.shift();
    scene.remove(old);
  }
  bloodDecals.push(decal);
}
const bloodDecals = [];

function updateBlood(dt) {
  for (let i = bloodParticles.length - 1; i >= 0; i--) {
    const b = bloodParticles[i];
    b.vel.y -= 9.8 * dt;
    b.mesh.position.addScaledVector(b.vel, dt);
    if (b.mesh.position.y < 0.02) {
      b.mesh.position.y = 0.02;
      b.vel.set(0, 0, 0);
      b.life -= dt * 0.6;
    } else {
      b.life -= dt * 0.25;
    }
    b.mesh.scale.setScalar(Math.max(b.life, 0.05));
    if (b.life <= 0) {
      scene.remove(b.mesh);
      bloodParticles.splice(i, 1);
    }
  }
}

// ---------- ШАТАНИЕ / ПАДЕНИЕ (физика) ----------
const rigAnim = {}; // slot -> { staggerStart, downStart, fallen, deadFall }
function easeOutBack(t) {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}
function triggerStagger(slot) {
  if (!rigAnim[slot]) rigAnim[slot] = {};
  rigAnim[slot].staggerStart = performance.now();
}
function triggerFall(slot, isDeath) {
  if (!rigAnim[slot]) rigAnim[slot] = {};
  rigAnim[slot].downStart = performance.now();
  rigAnim[slot].deadFall = isDeath;
}
function updateRigAnim(dt) {
  Object.keys(rigAnim).forEach((slotStr) => {
    const slot = Number(slotStr);
    const rig = rigs[slot];
    if (!rig) return;
    const a = rigAnim[slot];
    const now = performance.now();

    let wobble = 0;
    if (a.staggerStart && !a.downStart) {
      const t = (now - a.staggerStart) / STAGGER_VISUAL_MS;
      if (t < 1) {
        wobble = Math.sin(t * Math.PI * 5) * (1 - t) * 0.18;
      } else {
        a.staggerStart = null;
      }
    }

    let fallAngle = 0;
    if (a.downStart) {
      const t = Math.min(1, (now - a.downStart) / 700);
      fallAngle = easeOutBack(t) * (Math.PI / 2 * 0.92);
    }

    rig.rotation.z = wobble + fallAngle;
    rig.position.y = fallAngle > 0.1 ? Math.max(0, 0.9 - fallAngle * 0.55) : 0;
  });
}
const STAGGER_VISUAL_MS = 480;

// ---------- НИКНЕЙМЫ ----------
function addLabel(slot, nickname) {
  if (labels[slot]) {
    labels[slot].element.textContent = nickname;
    return;
  }
  const div = document.createElement('div');
  div.textContent = nickname;
  div.style.color = '#fff';
  div.style.fontSize = '12px';
  div.style.fontWeight = 'bold';
  div.style.textShadow = '0 2px 4px rgba(0,0,0,0.9)';
  div.style.padding = '2px 6px';
  div.style.background = 'rgba(0,0,0,0.35)';
  div.style.borderRadius = '6px';
  const label = new CSS2DObject(div);
  label.position.set(0, 2.0, 0);
  rigs[slot].add(label);
  labels[slot] = label;
}

// ---------- СЕТЬ ----------
const socket = io();
socket.emit('get_stats');

socket.on('stats_update', (data) => {
  const el = document.getElementById('online-count');
  if (el) el.textContent = data.online;
  const gEl = document.getElementById('total-games');
  if (gEl) gEl.textContent = data.totalGames;
});

function ensureRig(slot, isMe) {
  if (rigs[slot]) return rigs[slot];
  const rig = buildFighter(opponentColors[slot]);
  rig.visible = !isMe; // свою модель от первого лица не рисуем
  scene.add(rig);
  rigs[slot] = rig;
  return rig;
}

socket.on('joined', (data) => {
  mySlot = data.slot;
  players = data.players;
  statusEl.textContent = 'Ждём соперника...';
  Object.values(players).forEach((p) => {
    ensureRig(p.slot, p.slot === mySlot);
    addLabel(p.slot, p.nickname);
    syncRigTransform(p);
  });
});
socket.on('opponent_joined', (data) => {
  players = data.players;
  Object.values(players).forEach((p) => {
    ensureRig(p.slot, p.slot === mySlot);
    addLabel(p.slot, p.nickname);
    syncRigTransform(p);
  });
});
socket.on('start_game', (data) => {
  players = data.players;
  statusEl.textContent = '';
  finished = false;
  dead = false;
  myArmBroken = false;
  myDown = false;
  if (koOverlay) koOverlay.classList.remove('show');
});
socket.on('opponent_move', (data) => {
  const p = Object.values(players).find((pl) => pl.slot === data.slot);
  if (p) { p.x = data.x; p.z = data.z; p.yaw = data.yaw; }
  syncRigTransform({ slot: data.slot, x: data.x, z: data.z, yaw: data.yaw });
});
socket.on('shot_fired', (data) => {
  if (data.slot === mySlot) return;
  // вспышка на модели соперника
  const rig = rigs[data.slot];
  if (rig) {
    const flash = new THREE.PointLight(0xfff4c2, 6, 3, 2);
    flash.position.set(0, 1.3, 0);
    rig.add(flash);
    setTimeout(() => rig.remove(flash), 60);
  }
});
socket.on('player_hit', (data) => {
  const target = Object.values(players).find((p) => p.slot === data.targetSlot);
  if (target) {
    target.armBroken = data.armBroken;
    target.down = data.down;
    target.dead = data.dead;
  }
  if (data.point) spawnBlood(new THREE.Vector3(data.point.x, data.point.y, data.point.z), data.part === 'head');
  triggerStagger(data.targetSlot);
  if (data.down || data.dead) triggerFall(data.targetSlot, data.dead);

  if (data.targetSlot === mySlot) {
    myArmBroken = data.armBroken;
    myDown = data.down;
    if (data.down) camera.position.y = 0.9;
  } else {
    showXray(data.part);
    showHitMarker();
  }
});
socket.on('room_full', () => { statusEl.textContent = 'Комната уже занята'; });
socket.on('opponent_left', () => { statusEl.textContent = 'Соперник вышел'; });
socket.on('game_over', (data) => {
  finished = true;
  const won = data.winnerSlot === mySlot;
  koText.textContent = won ? '🏆 ПОБЕДА' : '💀 ТЫ УБИТ';
  koSub.textContent = won ? 'Соперник повержен' : 'Дуэль проиграна';
  setTimeout(() => koOverlay.classList.add('show'), 500);
});

function syncRigTransform(p) {
  const rig = rigs[p.slot];
  if (!rig) return;
  rig.position.x = p.x;
  rig.position.z = p.z;
  rig.rotation.y = p.yaw + Math.PI;
}

// ---------- МЕНЮ ----------
const nickInput = document.getElementById('nick-input');
const savedNick = localStorage.getItem('duel_nick');
if (savedNick) nickInput.value = savedNick;

document.getElementById('play-btn').addEventListener('click', () => {
  const nickname = nickInput.value.trim() || 'Игрок';
  localStorage.setItem('duel_nick', nickname);
  document.getElementById('menu-overlay').style.display = 'none';
  socket.emit('join_room', { roomId, nickname });
  ensureAudio();
});

document.getElementById('share-btn').addEventListener('click', () => {
  const inviteLink = `https://t.me/${BOT_USERNAME}?start=${roomId}`;
  if (tg && tg.openTelegramLink) {
    tg.openTelegramLink('https://t.me/share/url?url=' + encodeURIComponent(inviteLink) + '&text=' + encodeURIComponent('Го на дуэль 🔫'));
  } else if (navigator.share) {
    navigator.share({ text: 'Го на дуэль 🔫', url: inviteLink });
  }
});

// ---------- ЗВУК ВЫСТРЕЛА (глушитель — приглушённый хлопок) ----------
let audioCtx = null;
function ensureAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
}
function playShot() {
  if (!audioCtx) return;
  const bufferSize = audioCtx.sampleRate * 0.08;
  const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
  const src = audioCtx.createBufferSource();
  src.buffer = buffer;
  const filter = audioCtx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 1400;
  const gain = audioCtx.createGain();
  gain.gain.value = 0.35;
  src.connect(filter).connect(gain).connect(audioCtx.destination);
  src.start();
}

// ---------- УПРАВЛЕНИЕ: ВЗГЛЯД (перетаскивание пальцем) ----------
let yaw = Math.PI;
let pitch = 0;
const lookZone = document.getElementById('look-zone');
let lookTouchId = null;
let lastLookX = 0, lastLookY = 0;

function lookStart(e) {
  const t = e.touches ? e.touches[0] : e;
  lookTouchId = e.touches ? t.identifier : 'mouse';
  lastLookX = t.clientX;
  lastLookY = t.clientY;
}
function lookMove(e) {
  let t = null;
  if (e.touches) {
    for (let i = 0; i < e.touches.length; i++) {
      if (e.touches[i].identifier === lookTouchId) t = e.touches[i];
    }
  } else if (lookTouchId === 'mouse') {
    t = e;
  }
  if (!t) return;
  const dx = t.clientX - lastLookX;
  const dy = t.clientY - lastLookY;
  lastLookX = t.clientX;
  lastLookY = t.clientY;
  yaw -= dx * 0.0045;
  pitch = Math.max(-1.1, Math.min(1.1, pitch - dy * 0.0045));
}
function lookEnd() { lookTouchId = null; }

lookZone.addEventListener('touchstart', (e) => { e.preventDefault(); lookStart(e); }, { passive: false });
lookZone.addEventListener('touchmove', (e) => { e.preventDefault(); lookMove(e); }, { passive: false });
lookZone.addEventListener('touchend', lookEnd);
lookZone.addEventListener('mousedown', lookStart);
window.addEventListener('mousemove', lookMove);
window.addEventListener('mouseup', lookEnd);

// ---------- УПРАВЛЕНИЕ: ДВИЖЕНИЕ (джойстик) ----------
const zone = document.getElementById('joystick-zone');
const knob = document.getElementById('joystick-knob');
let moveVec = { x: 0, z: 0 };
let joyTouchId = null;

function setKnob(dx, dz) {
  const max = 40;
  knob.style.left = (46 + Math.max(-max, Math.min(max, dx))) + 'px';
  knob.style.top = (46 + Math.max(-max, Math.min(max, dz))) + 'px';
}
function joyStart(e) {
  e.preventDefault();
  const t = e.touches ? e.touches[0] : e;
  joyTouchId = e.touches ? t.identifier : 'mouse';
}
function joyMove(e) {
  let t = null;
  if (e.touches) {
    for (let i = 0; i < e.touches.length; i++) {
      if (e.touches[i].identifier === joyTouchId) t = e.touches[i];
    }
  } else if (joyTouchId === 'mouse') {
    t = e;
  }
  if (!t) return;
  const rect = zone.getBoundingClientRect();
  const dx = t.clientX - (rect.left + rect.width / 2);
  const dz = t.clientY - (rect.top + rect.height / 2);
  const len = Math.hypot(dx, dz) || 1;
  const clampedLen = Math.min(len, 44);
  setKnob((dx / len) * clampedLen, (dz / len) * clampedLen);
  moveVec.x = (dx / len) * (clampedLen / 44);
  moveVec.z = (dz / len) * (clampedLen / 44);
}
function joyEnd() {
  joyTouchId = null;
  moveVec.x = 0; moveVec.z = 0;
  knob.style.left = '46px'; knob.style.top = '46px';
}
zone.addEventListener('touchstart', joyStart, { passive: false });
zone.addEventListener('touchmove', (e) => { e.preventDefault(); joyMove(e); }, { passive: false });
zone.addEventListener('touchend', joyEnd);
zone.addEventListener('mousedown', joyStart);
window.addEventListener('mousemove', joyMove);
window.addEventListener('mouseup', joyEnd);

// ---------- СТРЕЛЬБА ----------
let ammo = 7;
const MAG_SIZE = 7;
let reloading = false;
let lastShotTime = 0;
const FIRE_COOLDOWN = 340;
const raycaster = new THREE.Raycaster();

function updateAmmoUI() {
  ammoEl.textContent = reloading ? 'ПЕРЕЗАРЯДКА...' : ammo + ' / ' + MAG_SIZE;
}

function reload() {
  if (reloading) return;
  reloading = true;
  fireBtn.classList.add('reloading');
  updateAmmoUI();
  setTimeout(() => {
    ammo = MAG_SIZE;
    reloading = false;
    fireBtn.classList.remove('reloading');
    updateAmmoUI();
  }, 1400);
}

function fire() {
  if (finished || dead || myDown && false) {} // myDown больше не блокирует стрельбу — можно стрелять лёжа
  if (finished || dead) return;
  const now = performance.now();
  if (reloading || now - lastShotTime < FIRE_COOLDOWN) return;
  if (ammo <= 0) { reload(); return; }
  lastShotTime = now;
  ammo--;
  updateAmmoUI();
  ensureAudio();
  playShot();

  // отдача + вспышка
  gunGroup.position.z += 0.05;
  muzzleFlash.intensity = 5;
  setTimeout(() => { muzzleFlash.intensity = 0; }, 40);
  setTimeout(() => { gunGroup.position.z -= 0.05; }, 60);

  // разброс, если рука сломана
  const spread = myArmBroken ? 0.05 : 0.006;
  const dir = new THREE.Vector3(
    (Math.random() - 0.5) * spread,
    (Math.random() - 0.5) * spread,
    0
  );
  raycaster.setFromCamera(new THREE.Vector2(dir.x, dir.y), camera);

  let hit = false;
  let part = null;
  let point = null;
  Object.keys(rigs).forEach((slotStr) => {
    const slot = Number(slotStr);
    if (slot === mySlot) return;
    const rig = rigs[slot];
    if (!rig.visible) return;
    const intersects = raycaster.intersectObjects(rig.children, true);
    if (intersects.length > 0 && !hit) {
      hit = true;
      part = intersects[0].object.userData.part || 'torso';
      point = intersects[0].point;
    }
  });

  socket.emit('shoot', {
    hit,
    part,
    point: point ? { x: point.x, y: point.y, z: point.z } : null,
  });

  if (ammo <= 0) reload();
}

fireBtn.addEventListener('touchstart', (e) => { e.preventDefault(); fire(); }, { passive: false });
fireBtn.addEventListener('mousedown', fire);

// ---------- ОСНОВНОЙ ЦИКЛ ----------
let lastFrame = performance.now();
function animate() {
  requestAnimationFrame(animate);
  const now = performance.now();
  const dt = Math.min((now - lastFrame) / 1000, 0.05);
  lastFrame = now;

  camera.rotation.order = 'YXZ';
  camera.rotation.y = yaw;
  camera.rotation.x = pitch;

  if (!finished && !dead && mySlot !== null) {
    const speed = myDown ? 0.6 : 2.6;
    const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const move = new THREE.Vector3()
      .addScaledVector(forward, -moveVec.z)
      .addScaledVector(right, moveVec.x);
    if (move.lengthSq() > 0.0001) {
      move.normalize().multiplyScalar(speed * dt);
      camera.position.x += move.x;
      camera.position.z += move.z;
      camera.position.x = Math.max(-9, Math.min(9, camera.position.x));
      camera.position.z = Math.max(-9, Math.min(9, camera.position.z));
      socket.emit('move', { x: camera.position.x, z: camera.position.z, yaw });
    }
  }

  updateBlood(dt);
  updateRigAnim(dt);

  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
}
animate();
