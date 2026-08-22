/* ============================================================
   SILENCED — дуэльный шутер от первого лица
   Движок: Three.js. Физика частей тела: упрощённая (ragdoll-lite):
   у каждого юнита руки/ноги/голова — отдельные меши-суставы.
   При попадании сустав отделяется, получает импульс + гравитацию,
   и юнит меняет позу/поведение (стреляет другой рукой, стоит на
   одной ноге и т.д.)
   ============================================================ */

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

// ---------- Глобальное состояние ----------
const state = {
  screen: 'menu',          // menu | duel | result
  round: 0,
  wins: 0,
  losses: 0,
  playerLimbs: { leftArm: true, rightArm: true, leftLeg: true, rightLeg: true, alive: true },
  shootHand: 'right',
  bot: null,
  botIndex: 0,
  duelPhase: 'idle',        // idle | countdown | fight | resolved
  countdownVal: 3,
  aimYaw: 0,
  aimPitch: 0,
  ammo: 7,
  reloading: false,
  lastShotAt: 0,
};

const BOTS = [
  { name: 'Виктор "Тень"',   tie: 0x8b1a1a, accuracy: 0.55, reaction: [900, 1400] },
  { name: 'Маркус Коул',     tie: 0x1a3a8b, accuracy: 0.70, reaction: [650, 1050] },
  { name: 'Адам "Континенталь"', tie: 0xdaa520, accuracy: 0.85, reaction: [450, 800] },
];

// ---------- Three.js базовая настройка ----------
const canvas = document.getElementById('game-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x05070c, 0.045);
scene.background = new THREE.Color(0x05070c);

const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.05, 100);
camera.position.set(0, 1.7, 5.2);

function resize() {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

// ---------- Освещение: неоновый нуар ----------
scene.add(new THREE.AmbientLight(0x33405a, 0.55));

const key = new THREE.SpotLight(0xfff1de, 3.2, 20, Math.PI / 5, 0.4, 1.4);
key.position.set(-3, 6, 2);
key.castShadow = true;
key.shadow.mapSize.set(1024, 1024);
scene.add(key);

const rim1 = new THREE.PointLight(0x5566ff, 6, 14, 2);
rim1.position.set(4, 2.2, -4);
scene.add(rim1);

const rim2 = new THREE.PointLight(0xff2d55, 5, 14, 2);
rim2.position.set(-4, 1.8, -6);
scene.add(rim2);

// ---------- Окружение: мокрый переулок / зал ----------
const floorGeo = new THREE.PlaneGeometry(40, 60, 1, 1);
const floorMat = new THREE.MeshStandardMaterial({ color: 0x11141c, roughness: 0.25, metalness: 0.3 });
const floor = new THREE.Mesh(floorGeo, floorMat);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

// колонны по бокам для атмосферы
for (let i = -1; i <= 1; i += 2) {
  for (let z = -8; z <= 8; z += 4) {
    const col = new THREE.Mesh(
      new THREE.BoxGeometry(0.6, 4.5, 0.6),
      new THREE.MeshStandardMaterial({ color: 0x0c0e14, roughness: 0.6 })
    );
    col.position.set(i * 6, 2.25, z);
    col.castShadow = true;
    scene.add(col);
  }
}
// неоновые полоски на колоннах
for (let i = -1; i <= 1; i += 2) {
  const strip = new THREE.Mesh(
    new THREE.BoxGeometry(0.05, 4, 0.05),
    new THREE.MeshBasicMaterial({ color: i < 0 ? 0x5566ff : 0xff2d55 })
  );
  strip.position.set(i * 6.35, 2.2, 0);
  scene.add(strip);
}

// лёгкий туман частиц (дождь/пыль)
const dustGeo = new THREE.BufferGeometry();
const dustCount = 400;
const dustPos = new Float32Array(dustCount * 3);
for (let i = 0; i < dustCount; i++) {
  dustPos[i * 3] = (Math.random() - 0.5) * 30;
  dustPos[i * 3 + 1] = Math.random() * 6;
  dustPos[i * 3 + 2] = (Math.random() - 0.5) * 30;
}
dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ color: 0x8899ff, size: 0.02, transparent: true, opacity: 0.35 }));
scene.add(dust);

// ---------- Конструктор гуманоида в стиле "Continental Suit" ----------
const SUIT = 0x0b0c10;
const SHIRT = 0x1c1d22;
const SKIN = 0xcda37b;

function buildHumanoid(tieColor) {
  const root = new THREE.Group();

  const suitMat = new THREE.MeshStandardMaterial({ color: SUIT, roughness: 0.45, metalness: 0.15 });
  const skinMat = new THREE.MeshStandardMaterial({ color: SKIN, roughness: 0.6 });
  const tieMat = new THREE.MeshStandardMaterial({ color: tieColor, roughness: 0.35, metalness: 0.2 });

  // Таз/опора — не отстреливается, это "корень"
  const pelvis = new THREE.Group();
  pelvis.position.y = 0.95;
  root.add(pelvis);

  // Торс
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 0.55, 4, 8), suitMat);
  torso.position.y = 0.42;
  torso.castShadow = true;
  torso.name = 'torso';
  pelvis.add(torso);

  const tie = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.4, 0.02), tieMat);
  tie.position.set(0, 0.5, 0.24);
  torso.add(tie);

  // Голова (на шее, к торсу)
  const headJoint = new THREE.Group();
  headJoint.position.set(0, 0.78, 0);
  pelvis.add(headJoint);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 16), skinMat);
  head.castShadow = true;
  head.name = 'head';
  headJoint.add(head);

  function buildArm(side) {
    const sign = side === 'left' ? -1 : 1;
    const shoulder = new THREE.Group();
    shoulder.position.set(sign * 0.32, 0.62, 0);
    pelvis.add(shoulder);

    const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.28, 4, 8), suitMat);
    upper.position.y = -0.16;
    upper.castShadow = true;
    shoulder.add(upper);

    const elbow = new THREE.Group();
    elbow.position.y = -0.32;
    shoulder.add(elbow);

    const lower = new THREE.Mesh(new THREE.CapsuleGeometry(0.065, 0.26, 4, 8), skinMat);
    lower.position.y = -0.14;
    lower.castShadow = true;
    elbow.add(lower);

    const hand = new THREE.Group();
    hand.position.y = -0.29;
    elbow.add(hand);

    shoulder.name = side + 'Arm';
    shoulder.userData.part = side + 'Arm';
    shoulder.userData.hand = hand;
    return shoulder;
  }

  function buildLeg(side) {
    const sign = side === 'left' ? -1 : 1;
    const hip = new THREE.Group();
    hip.position.set(sign * 0.12, 0, 0);
    pelvis.add(hip);

    const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.34, 4, 8), suitMat);
    upper.position.y = -0.19;
    upper.castShadow = true;
    hip.add(upper);

    const knee = new THREE.Group();
    knee.position.y = -0.38;
    hip.add(knee);

    const lower = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.32, 4, 8), suitMat);
    lower.position.y = -0.18;
    lower.castShadow = true;
    knee.add(lower);

    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.06, 0.24), new THREE.MeshStandardMaterial({ color: 0x08090c }));
    foot.position.set(0, -0.37, 0.05);
    knee.add(foot);

    hip.name = side + 'Leg';
    hip.userData.part = side + 'Leg';
    return hip;
  }

  const leftArm = buildArm('left');
  const rightArm = buildArm('right');
  const leftLeg = buildLeg('left');
  const rightLeg = buildLeg('right');

  // пистолет с глушителем, крепится в руку
  function buildGun() {
    const g = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x1a1b1e, roughness: 0.3, metalness: 0.85 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.09, 0.19), bodyMat);
    g.add(body);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.22, 10), bodyMat);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.015, -0.2);
    g.add(barrel);
    const suppressor = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.16, 10), new THREE.MeshStandardMaterial({ color: 0x24262b, roughness: 0.4, metalness: 0.9 }));
    suppressor.rotation.x = Math.PI / 2;
    suppressor.position.set(0, 0.015, -0.36);
    g.add(suppressor);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.09, 0.05), new THREE.MeshStandardMaterial({ color: 0x0c0d10, roughness: 0.7 }));
    grip.position.set(0, -0.07, 0.06);
    grip.rotation.x = 0.35;
    g.add(grip);
    return g;
  }

  const gunR = buildGun();
  rightArm.userData.hand.add(gunR);
  const gunL = buildGun();
  gunL.visible = false;
  leftArm.userData.hand.add(gunL);

  root.userData = {
    pelvis, torso, headJoint, head,
    limbs: { leftArm, rightArm, leftLeg, rightLeg },
    guns: { right: gunR, left: gunL },
    alive: true,
    limbState: { leftArm: true, rightArm: true, leftLeg: true, rightLeg: true },
    baseY: 0,
  };

  return root;
}

// ---------- Игрок: видимые руки/оружие от первого лица ----------
const fpRig = new THREE.Group();
camera.add(fpRig);
scene.add(camera);

function buildFPGun() {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x1a1b1e, roughness: 0.25, metalness: 0.9 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.11, 0.24), bodyMat);
  g.add(body);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.017, 0.26, 12), bodyMat);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.02, -0.24);
  g.add(barrel);
  const suppressor = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.2, 12), new THREE.MeshStandardMaterial({ color: 0x26282d, roughness: 0.35, metalness: 0.95 }));
  suppressor.rotation.x = Math.PI / 2;
  suppressor.position.set(0, 0.02, -0.46);
  g.add(suppressor);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.12, 0.06), new THREE.MeshStandardMaterial({ color: 0x0c0d10, roughness: 0.7 }));
  grip.position.set(0, -0.09, 0.08);
  grip.rotation.x = 0.3;
  g.add(grip);
  const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.22, 8), new THREE.MeshStandardMaterial({ color: SUIT, roughness: 0.5 }));
  sleeve.rotation.z = Math.PI / 2;
  sleeve.position.set(0.02, -0.12, 0.22);
  g.add(sleeve);
  return g;
}

const fpGunRight = buildFPGun();
fpGunRight.position.set(0.16, -0.16, -0.35);
fpGunRight.rotation.y = -0.05;
fpRig.add(fpGunRight);

const fpGunLeft = buildFPGun();
fpGunLeft.position.set(-0.16, -0.16, -0.35);
fpGunLeft.rotation.y = 0.05;
fpGunLeft.visible = false;
fpRig.add(fpGunLeft);

// вспышка выстрела
const muzzleLight = new THREE.PointLight(0xffdca0, 0, 4, 2);
camera.add(muzzleLight);

// ---------- Кровь: система частиц + декали-заплатки ----------
const bloodParticles = [];
function spawnBlood(position, count = 26) {
  const geo = new THREE.SphereGeometry(1, 4, 4);
  const mat = new THREE.MeshBasicMaterial({ color: 0x8a0f16 });
  for (let i = 0; i < count; i++) {
    const p = new THREE.Mesh(geo, mat);
    const s = 0.012 + Math.random() * 0.02;
    p.scale.setScalar(s);
    p.position.copy(position);
    scene.add(p);
    bloodParticles.push({
      mesh: p,
      vel: new THREE.Vector3((Math.random() - 0.5) * 2.4, Math.random() * 2.2 + 0.6, (Math.random() - 0.5) * 2.4),
      life: 0,
      maxLife: 1.4 + Math.random(),
    });
  }
  // лужа на полу
  const pool = new THREE.Mesh(
    new THREE.CircleGeometry(0.06 + Math.random() * 0.05, 10),
    new THREE.MeshStandardMaterial({ color: 0x5c0a10, roughness: 0.2, metalness: 0.1, transparent: true, opacity: 0.85 })
  );
  pool.rotation.x = -Math.PI / 2;
  pool.position.set(position.x + (Math.random() - 0.5) * 0.3, 0.01, position.z + (Math.random() - 0.5) * 0.3);
  scene.add(pool);
}

// ---------- Отсоединяемые части тела (падают под гравитацией) ----------
const fallingParts = [];
function detachLimb(unit, limbKey) {
  const limbData = unit.userData;
  if (!limbData.limbState[limbKey]) return;
  limbData.limbState[limbKey] = false;

  const limbGroup = limbData.limbs[limbKey];
  const worldPos = new THREE.Vector3();
  const worldQuat = new THREE.Quaternion();
  limbGroup.getWorldPosition(worldPos);
  limbGroup.getWorldQuaternion(worldQuat);

  scene.attach(limbGroup); // сохраняет мировую трансформацию, отсоединяет от родителя
  fallingParts.push({
    obj: limbGroup,
    vel: new THREE.Vector3((Math.random() - 0.5) * 1.2, 1.4 + Math.random(), (Math.random() - 0.5) * 1.2),
    angVel: new THREE.Vector3((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6),
    life: 0,
  });

  limbGroup.visible = true; // сама часть остаётся видимой — она физически лежит на полу
  spawnBlood(worldPos, 30);

  // Реакция юнита на потерю конечности
  if (limbKey === 'rightArm' || limbKey === 'leftArm') {
    const otherHand = limbKey === 'rightArm' ? 'left' : 'right';
    switchShootingHand(unit, otherHand);
  }
  if (limbKey === 'leftLeg' || limbKey === 'rightLeg') {
    unit.userData.limping = true;
  }
}

function switchShootingHand(unit, hand) {
  unit.userData.shootHand = hand;
  if (unit === playerUnit) {
    state.shootHand = hand;
    fpGunRight.visible = hand === 'right' && state.playerLimbs.rightArm;
    fpGunLeft.visible = hand === 'left' && state.playerLimbs.leftArm;
  } else {
    unit.userData.guns.right.visible = hand === 'right' && unit.userData.limbState.rightArm;
    unit.userData.guns.left.visible = hand === 'left' && unit.userData.limbState.leftArm;
  }
}

function killUnit(unit) {
  unit.userData.alive = false;
  // "садится"/падает — быстрая коллапс-анимация всей фигуры
  unit.userData.deathT = 0;
}

// ---------- Создание игрока (невидимые хитбоксы для попаданий бота) и противника ----------
let playerUnit = buildHumanoid(0x333333);
playerUnit.visible = false; // сам игрок не рендерится (от первого лица), но хитбоксы используются для расчёта попаданий бота
playerUnit.position.set(0, 0, 4.6);
scene.add(playerUnit);

let enemyUnit = buildHumanoid(BOTS[0].tie);
enemyUnit.position.set(0, 0, -4.6);
enemyUnit.rotation.y = Math.PI;
scene.add(enemyUnit);

// имя над противником (спрайт с canvas-текстурой)
function makeLabel(text) {
  const cnv = document.createElement('canvas');
  cnv.width = 512; cnv.height = 96;
  const ctx = cnv.getContext('2d');
  ctx.fillStyle = 'rgba(0,0,0,0)';
  ctx.fillRect(0, 0, 512, 96);
  ctx.font = '600 40px system-ui, sans-serif';
  ctx.fillStyle = '#ff2d55';
  ctx.textAlign = 'center';
  ctx.shadowColor = '#000'; ctx.shadowBlur = 8;
  ctx.fillText(text, 256, 60);
  const tex = new THREE.CanvasTexture(cnv);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const spr = new THREE.Sprite(mat);
  spr.scale.set(1.6, 0.3, 1);
  spr.position.set(0, 2, 0);
  return spr;
}
let enemyLabel = makeLabel(BOTS[0].name);
enemyUnit.add(enemyLabel);

// ---------- Ввод: тач/мышь для прицеливания, тап/клик для выстрела ----------
let dragging = false;
let lastX = 0, lastY = 0;
const sensitivity = 0.0028;

function onPointerDown(x, y) { dragging = true; lastX = x; lastY = y; }
function onPointerMove(x, y) {
  if (!dragging) return;
  const dx = x - lastX, dy = y - lastY;
  lastX = x; lastY = y;
  state.aimYaw -= dx * sensitivity;
  state.aimPitch -= dy * sensitivity;
  state.aimPitch = Math.max(-0.5, Math.min(0.5, state.aimPitch));
  state.aimYaw = Math.max(-0.7, Math.min(0.7, state.aimYaw));
}
function onPointerUp() { dragging = false; }

canvas.addEventListener('mousedown', e => onPointerDown(e.clientX, e.clientY));
addEventListener('mousemove', e => onPointerMove(e.clientX, e.clientY));
addEventListener('mouseup', onPointerUp);

canvas.addEventListener('touchstart', e => { const t = e.touches[0]; onPointerDown(t.clientX, t.clientY); }, { passive: true });
canvas.addEventListener('touchmove', e => { const t = e.touches[0]; onPointerMove(t.clientX, t.clientY); }, { passive: true });
canvas.addEventListener('touchend', onPointerUp);

const fireBtn = document.getElementById('fire-btn');
function tryPlayerShoot() {
  if (state.screen !== 'duel' || state.duelPhase !== 'fight') return;
  if (!enemyUnit.userData.alive) return;
  if (!state.playerLimbs.leftArm && !state.playerLimbs.rightArm) return; // обе руки выбиты — не выстрелить
  if (Date.now() - state.lastShotAt < 260) return;
  state.lastShotAt = Date.now();
  playerFire();
}
fireBtn.addEventListener('click', tryPlayerShoot);
addEventListener('keydown', e => { if (e.code === 'Space') tryPlayerShoot(); });

// ---------- Выстрел игрока: raycast по частям тела бота ----------
const raycaster = new THREE.Raycaster();
function playerFire() {
  muzzleFlash(state.shootHand === 'right' ? fpGunRight : fpGunLeft);
  screenKick();

  raycaster.setFromCamera({ x: 0, y: 0 }, camera);
  const hittable = collectHittableMeshes(enemyUnit);
  const hits = raycaster.intersectObjects(hittable, false);
  if (hits.length > 0) {
    resolveHit(enemyUnit, hits[0].object, hits[0].point);
  } else {
    playSound('miss');
  }
}

function collectHittableMeshes(unit) {
  const list = [];
  unit.traverse(o => {
    if (o.isMesh && (o.name === 'torso' || o.name === 'head')) list.push(o);
    if (o.isMesh && o.parent && o.parent.parent && o.parent.parent.userData && o.parent.parent.userData.part) list.push(o);
  });
  // также сами группы конечностей содержат child-мешы upper/lower — простой подход: собрать все меши внутри limb-групп
  Object.values(unit.userData.limbs).forEach(limbGroup => {
    if (unit.userData.limbState[limbGroup.userData.part]) {
      limbGroup.traverse(o => { if (o.isMesh && !list.includes(o)) list.push(o); });
    }
  });
  return list;
}

function findPartKeyFromMesh(unit, mesh) {
  if (mesh.name === 'torso') return 'torso';
  if (mesh.name === 'head') return 'head';
  let p = mesh;
  while (p) {
    if (p.userData && p.userData.part) return p.userData.part;
    p = p.parent;
  }
  return null;
}

function resolveHit(unit, mesh, point) {
  const partKey = findPartKeyFromMesh(unit, mesh);
  if (!partKey) return;
  spawnBlood(point, 18);
  playSound('hit');

  if (partKey === 'head' || partKey === 'torso') {
    if (unit === enemyUnit) { endRound(true); } else { endRound(false); }
    return;
  }
  if (unit === enemyUnit) {
    detachLimb(unit, partKey);
  } else {
    applyPlayerLimbHit(partKey);
  }
}

// ---------- Урон игроку от бота ----------
function applyPlayerLimbHit(limbKey) {
  if (!state.playerLimbs[limbKey]) return;
  state.playerLimbs[limbKey] = false;
  detachLimb(playerUnit, limbKey);
  flashDamage();

  if (limbKey === 'rightArm' && state.shootHand === 'right') {
    if (state.playerLimbs.leftArm) switchShootingHand(playerUnit, 'left');
  } else if (limbKey === 'leftArm' && state.shootHand === 'left') {
    if (state.playerLimbs.rightArm) switchShootingHand(playerUnit, 'right');
  }
  if (limbKey === 'leftLeg' || limbKey === 'rightLeg') {
    playerLimping = true;
  }
}

let playerLimping = false;

function endRound(playerWon) {
  state.duelPhase = 'resolved';
  if (playerWon) {
    killUnit(enemyUnit);
    state.wins++;
  } else {
    state.losses++;
    flashDamage(1);
  }
  setTimeout(() => showResult(playerWon), 900);
}

// ---------- Визуальные эффекты выстрела/урона ----------
function muzzleFlash(gunObj) {
  muzzleLight.intensity = 6;
  muzzleLight.position.copy(gunObj.position);
  setTimeout(() => (muzzleLight.intensity = 0), 60);
}
function screenKick() {
  camera.rotation.z += (Math.random() - 0.5) * 0.01;
}
const damageOverlay = document.getElementById('damage-overlay');
function flashDamage(strength = 0.55) {
  damageOverlay.style.opacity = strength;
  setTimeout(() => (damageOverlay.style.opacity = 0), 260);
}

// ---------- Простейший звук через WebAudio (без внешних файлов) ----------
let audioCtx;
function playSound(type) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.connect(g); g.connect(audioCtx.destination);
    if (type === 'shot') { o.frequency.value = 180; g.gain.value = 0.15; o.type = 'square'; }
    else if (type === 'hit') { o.frequency.value = 90; g.gain.value = 0.2; o.type = 'sawtooth'; }
    else { o.frequency.value = 260; g.gain.value = 0.05; o.type = 'sine'; }
    o.start();
    g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.18);
    o.stop(audioCtx.currentTime + 0.2);
  } catch (e) { /* аудио недоступно — молча пропускаем */ }
}

// ---------- Бот: ИИ ----------
function botFire(bot) {
  if (!playerUnit.userData.alive === false && state.duelPhase !== 'fight') return;
  playSound('shot');
  const acc = bot.accuracy - (enemyUnit.userData.limbState.rightArm || enemyUnit.userData.limbState.leftArm ? 0 : 1) ;
  const roll = Math.random();

  // выбор части тела: чем выше точность бота, тем чаще целится в корпус/голову
  let partKey;
  const r = Math.random();
  if (r < acc * 0.6) partKey = Math.random() < 0.85 ? 'torso' : 'head';
  else {
    const limbs = ['leftArm', 'rightArm', 'leftLeg', 'rightLeg'].filter(k => state.playerLimbs[k]);
    partKey = limbs.length ? limbs[Math.floor(Math.random() * limbs.length)] : 'torso';
  }

  // общий промах
  if (roll > acc + 0.15) {
    return; // мимо
  }

  const worldPoint = new THREE.Vector3();
  camera.getWorldPosition(worldPoint);
  spawnBlood(worldPoint.clone().add(new THREE.Vector3(0, -0.2, -0.3)), 14);

  if (partKey === 'torso' || partKey === 'head') {
    endRound(false);
  } else {
    applyPlayerLimbHit(partKey);
  }
}

// ---------- Управление раундом дуэли ----------
const hud = document.getElementById('hud');
const countdownEl = document.getElementById('countdown');
const crosshair = document.getElementById('crosshair');

function startDuel(botIdx) {
  state.botIndex = botIdx;
  state.bot = BOTS[botIdx];
  resetUnits();
  state.screen = 'duel';
  document.getElementById('menu').classList.add('hidden');
  document.getElementById('result').classList.add('hidden');
  hud.classList.remove('hidden');

  enemyUnit.remove(enemyLabel);
  enemyLabel = makeLabel(state.bot.name);
  enemyUnit.add(enemyLabel);
  enemyUnit.material && null;
  applyTie(enemyUnit, state.bot.tie);

  runCountdown();
}

function applyTie(unit, color) {
  unit.userData.torso.children.forEach(c => { if (c.geometry && c.geometry.type === 'BoxGeometry' && c.geometry.parameters.height === 0.4) c.material.color.setHex(color); });
}

function resetUnits() {
  // пересобираем полностью, чтобы вернуть оторванные части
  scene.remove(playerUnit);
  scene.remove(enemyUnit);
  fallingParts.length = 0;
  bloodParticles.forEach(b => scene.remove(b.mesh));
  bloodParticles.length = 0;
  scene.children.filter(o => o.geometry && o.geometry.type === 'CircleGeometry').forEach(o => scene.remove(o));

  Object.assign(playerUnitReplace());
  Object.assign(enemyUnitReplace());

  state.playerLimbs = { leftArm: true, rightArm: true, leftLeg: true, rightLeg: true, alive: true };
  playerLimping = false;
  state.shootHand = 'right';
  fpGunRight.visible = true;
  fpGunLeft.visible = false;
  camera.rotation.set(0, 0, 0);
  state.aimYaw = 0; state.aimPitch = 0;
  damageOverlay.style.opacity = 0;
}

let playerUnitRef, enemyUnitRef;
function playerUnitReplace() {
  const nu = buildHumanoid(0x333333);
  nu.visible = false;
  nu.position.set(0, 0, 4.6);
  scene.add(nu);
  playerUnitRef = nu;
  swapGlobalRef('player', nu);
  return {};
}
function enemyUnitReplace() {
  const nu = buildHumanoid(BOTS[state.botIndex].tie);
  nu.position.set(0, 0, -4.6);
  nu.rotation.y = Math.PI;
  scene.add(nu);
  enemyUnitRef = nu;
  swapGlobalRef('enemy', nu);
  return {};
}
function swapGlobalRef(which, nu) {
  if (which === 'player') { playerUnit = nu; }
  else { enemyUnit = nu; }
}

function runCountdown() {
  state.duelPhase = 'countdown';
  let n = 3;
  countdownEl.classList.remove('hidden');
  countdownEl.textContent = n;
  const iv = setInterval(() => {
    n--;
    if (n > 0) { countdownEl.textContent = n; }
    else if (n === 0) { countdownEl.textContent = 'ОГОНЬ'; countdownEl.classList.add('fire'); }
    else {
      clearInterval(iv);
      countdownEl.classList.add('hidden');
      countdownEl.classList.remove('fire');
      state.duelPhase = 'fight';
      scheduleBotShot();
    }
  }, 700);
}

function scheduleBotShot() {
  const bot = state.bot;
  const delay = bot.reaction[0] + Math.random() * (bot.reaction[1] - bot.reaction[0]);
  const t = setTimeout(() => {
    if (state.duelPhase !== 'fight') return;
    botFire(bot);
    if (state.duelPhase === 'fight') scheduleBotShot();
  }, delay);
}

const resultPanel = document.getElementById('result');
function showResult(won) {
  hud.classList.add('hidden');
  resultPanel.classList.remove('hidden');
  document.getElementById('result-title').textContent = won ? 'ЦЕЛЬ УСТРАНЕНА' : 'ВЫ УБИТЫ';
  document.getElementById('result-title').style.color = won ? '#4dd0a8' : '#ff2d55';
  document.getElementById('result-sub').textContent = won
    ? `${state.bot.name} повержен.`
    : `${state.bot.name} оказался быстрее.`;
  reportGamePlayed(won);
}

document.getElementById('btn-menu').addEventListener('click', () => {
  resultPanel.classList.add('hidden');
  document.getElementById('menu').classList.remove('hidden');
  state.screen = 'menu';
});
document.getElementById('btn-retry').addEventListener('click', () => startDuel(state.botIndex));

document.querySelectorAll('.bot-card').forEach((card, idx) => {
  card.addEventListener('click', () => startDuel(idx));
});

// ---------- Онлайн-счётчик и число сыгранных дуэлей (реальный бэкенд) ----------
let ws;
function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  try {
    ws = new WebSocket(`${proto}://${location.host}`);
    ws.onmessage = ev => {
      const data = JSON.parse(ev.data);
      if (data.type === 'stats') {
        document.getElementById('online-count').textContent = data.online;
        document.getElementById('played-count').textContent = data.played;
      }
    };
    ws.onclose = () => setTimeout(connectWS, 2000);
  } catch (e) { /* нет сети — офлайн-режим меню всё равно работает */ }
}
connectWS();

function reportGamePlayed(won) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'game_played', won }));
  }
}

// ---------- Основной цикл рендера ----------
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);

  // прицеливание камерой
  camera.rotation.order = 'YXZ';
  camera.rotation.y += (state.aimYaw - camera.rotation.y) * 0.25;
  camera.rotation.x += (state.aimPitch - camera.rotation.x) * 0.25;

  // покачивание при хромоте (нога отстрелена)
  const bobT = performance.now() / 1000;
  const limpOffset = playerLimping ? Math.sin(bobT * 5) * 0.05 : Math.sin(bobT * 1.2) * 0.006;
  camera.position.y = 1.7 + limpOffset;
  if (playerLimping) camera.rotation.z += Math.sin(bobT * 5) * 0.002;

  // летящие/лежащие оторванные части — простая гравитация
  fallingParts.forEach(fp => {
    fp.life += dt;
    if (fp.obj.position.y > 0.05) {
      fp.vel.y -= 9.8 * dt;
      fp.obj.position.addScaledVector(fp.vel, dt);
      fp.obj.rotation.x += fp.angVel.x * dt;
      fp.obj.rotation.y += fp.angVel.y * dt;
      fp.obj.rotation.z += fp.angVel.z * dt;
    } else {
      fp.obj.position.y = 0.05;
      fp.vel.multiplyScalar(0.8);
    }
  });

  // частицы крови
  for (let i = bloodParticles.length - 1; i >= 0; i--) {
    const b = bloodParticles[i];
    b.life += dt;
    if (b.mesh.position.y > 0.01) {
      b.vel.y -= 9.8 * dt;
      b.mesh.position.addScaledVector(b.vel, dt);
    }
    b.mesh.scale.multiplyScalar(0.985);
    if (b.life > b.maxLife) {
      scene.remove(b.mesh);
      bloodParticles.splice(i, 1);
    }
  }

  // юнит противника: наклон при хромоте / потере руки — простая целевая поза
  if (enemyUnit) {
    const eData = enemyUnit.userData;
    if (eData.limping) {
      const tilt = 0.18;
      eData.pelvis.rotation.z += (tilt - eData.pelvis.rotation.z) * 0.08;
      eData.pelvis.position.y += (-0.05 - (eData.pelvis.position.y - 0.95) ) * 0; // noop safeguard
    }
    if (!eData.alive) {
      eData.deathT = (eData.deathT || 0) + dt;
      const t = Math.min(eData.deathT / 0.9, 1);
      eData.pelvis.rotation.x = t * 1.35;
      eData.pelvis.position.y = 0.95 * (1 - t * 0.85);
    }
  }
  if (playerUnit) {
    const pData = playerUnit.userData;
    if (playerLimping) {
      pData.pelvis.rotation.z += (0.18 - pData.pelvis.rotation.z) * 0.08;
    }
  }

  dust.rotation.y += dt * 0.01;

  renderer.render(scene, camera);
}
animate();

// экспорт для отладки в консоли (необязательно)
window.__duel = { state, startDuel };
