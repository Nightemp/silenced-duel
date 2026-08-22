/* ============================================================
   SILENCED — дуэльный шутер от первого лица
   Движок: Three.js. Физика частей тела: упрощённая (ragdoll-lite):
   у каждого юнита руки/ноги/голова — отдельные меши-суставы.
   При попадании сустав отделяется, получает импульс + гравитацию,
   и юнит меняет позу/поведение (стреляет другой рукой, стоит на
   одной ноге и т.д.)
   Карты: "Дикий Запад" (солнечный день) и "Тёмный переулок" (ночь).
   Режимы: дуэль против бота (3 уровня сложности) и онлайн-дуэль 1×1
   через WebSocket-матчмейкинг на сервере.
   ============================================================ */

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

// ---------- Глобальное состояние ----------
const state = {
  screen: 'menu',          // menu | duel | result
  mapType: 'west',         // west | noir
  mode: 'bot',              // bot | online
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
  { name: 'Виктор "Тень"',   tie: 0x8b1a1a, accuracy: 0.55, reaction: [900, 1400] },   // Лёгкий
  { name: 'Маркус Коул',     tie: 0x1a3a8b, accuracy: 0.70, reaction: [650, 1050] },   // Средний
  { name: 'Адам "Континенталь"', tie: 0xdaa520, accuracy: 0.85, reaction: [450, 800] }, // Тяжёлый
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
const BASE_FOV = 62;
camera.position.set(0, 1.7, 5.2);

function resize() {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

// ---------- Освещение (общее для обеих карт, параметры меняются по теме) ----------
const amb = new THREE.AmbientLight(0x33405a, 0.55);
scene.add(amb);

const hemi = new THREE.HemisphereLight(0xbfe3ff, 0x2a2015, 0.15);
scene.add(hemi);

const key = new THREE.SpotLight(0xfff1de, 3.2, 24, Math.PI / 5, 0.4, 1.4);
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

// ---------- Пол (общий, цвет меняется по теме) ----------
const floorGeo = new THREE.PlaneGeometry(60, 90, 1, 1);
const floorMat = new THREE.MeshStandardMaterial({ color: 0x11141c, roughness: 0.25, metalness: 0.3 });
const floor = new THREE.Mesh(floorGeo, floorMat);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

// ---------- Декор "Тёмный переулок" ----------
const noirProps = new THREE.Group();
for (let i = -1; i <= 1; i += 2) {
  for (let z = -8; z <= 8; z += 4) {
    const col = new THREE.Mesh(
      new THREE.BoxGeometry(0.6, 4.5, 0.6),
      new THREE.MeshStandardMaterial({ color: 0x0c0e14, roughness: 0.6 })
    );
    col.position.set(i * 6, 2.25, z);
    col.castShadow = true;
    noirProps.add(col);
  }
}
for (let i = -1; i <= 1; i += 2) {
  const strip = new THREE.Mesh(
    new THREE.BoxGeometry(0.05, 4, 0.05),
    new THREE.MeshBasicMaterial({ color: i < 0 ? 0x5566ff : 0xff2d55 })
  );
  strip.position.set(i * 6.35, 2.2, 0);
  noirProps.add(strip);
}
scene.add(noirProps);

// ---------- Декор "Дикий Запад" (солнечный салун-таун) ----------
const westProps = new THREE.Group();

function buildSaloonFacade(x, z, rotY, tint) {
  const g = new THREE.Group();
  const woodMat = new THREE.MeshStandardMaterial({ color: tint, roughness: 0.85 });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x3a2415, roughness: 0.8 });

  const body = new THREE.Mesh(new THREE.BoxGeometry(4.2, 3.4, 3), woodMat);
  body.position.y = 1.7;
  body.castShadow = true;
  body.receiveShadow = true;
  g.add(body);

  const facadeTop = new THREE.Mesh(new THREE.BoxGeometry(4.6, 1, 0.3), trimMat);
  facadeTop.position.set(0, 3.7, 1.6);
  g.add(facadeTop);

  const porchRoof = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.15, 1.6), trimMat);
  porchRoof.position.set(0, 2.5, 2.2);
  g.add(porchRoof);

  for (let px = -1.9; px <= 1.9; px += 3.8) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 2.5, 8), trimMat);
    post.position.set(px, 1.25, 2.9);
    g.add(post);
  }

  const doorFrame = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.8, 0.1), trimMat);
  doorFrame.position.set(0, 0.9, 1.55);
  g.add(doorFrame);

  g.position.set(x, 0, z);
  g.rotation.y = rotY;
  return g;
}

westProps.add(buildSaloonFacade(-7, -3, Math.PI / 2, 0xa9814f));
westProps.add(buildSaloonFacade(-7, 3, Math.PI / 2, 0x8f6b41));
westProps.add(buildSaloonFacade(7, -3, -Math.PI / 2, 0x9c7648));
westProps.add(buildSaloonFacade(7, 3, -Math.PI / 2, 0xa9814f));

function buildCactus(x, z, scale) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x4c7a3a, roughness: 0.7 });
  const trunk = new THREE.Mesh(new THREE.CapsuleGeometry(0.14, 0.9, 4, 8), mat);
  trunk.position.y = 0.6;
  trunk.castShadow = true;
  g.add(trunk);
  const armL = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.4, 4, 8), mat);
  armL.position.set(-0.2, 0.75, 0);
  armL.rotation.z = 0.9;
  g.add(armL);
  const armR = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.35, 4, 8), mat);
  armR.position.set(0.22, 0.95, 0);
  armR.rotation.z = -0.8;
  g.add(armR);
  g.position.set(x, 0, z);
  g.scale.setScalar(scale);
  return g;
}
[[-3.2, 6, 1], [3.6, -7, 0.8], [-4.5, -6.5, 1.1], [4.8, 7.5, 0.9]].forEach(([x, z, s]) => {
  westProps.add(buildCactus(x, z, s));
});

// солнце — яркий диск с мягким свечением в небе
function buildSunSprite() {
  const cnv = document.createElement('canvas');
  cnv.width = 256; cnv.height = 256;
  const ctx = cnv.getContext('2d');
  const grad = ctx.createRadialGradient(128, 128, 10, 128, 128, 128);
  grad.addColorStop(0, 'rgba(255,250,225,1)');
  grad.addColorStop(0.35, 'rgba(255,232,170,0.9)');
  grad.addColorStop(1, 'rgba(255,220,150,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(cnv);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const spr = new THREE.Sprite(mat);
  spr.scale.set(14, 14, 1);
  spr.position.set(-10, 13, -22);
  return spr;
}
westProps.add(buildSunSprite());

scene.add(westProps);

// ---------- Пыль в воздухе (цвет/плотность меняются по теме) ----------
const dustGeo = new THREE.BufferGeometry();
const dustCount = 400;
const dustPos = new Float32Array(dustCount * 3);
for (let i = 0; i < dustCount; i++) {
  dustPos[i * 3] = (Math.random() - 0.5) * 30;
  dustPos[i * 3 + 1] = Math.random() * 6;
  dustPos[i * 3 + 2] = (Math.random() - 0.5) * 30;
}
dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
const dustMat = new THREE.PointsMaterial({ color: 0x8899ff, size: 0.02, transparent: true, opacity: 0.35 });
const dust = new THREE.Points(dustGeo, dustMat);
scene.add(dust);

// ---------- Переключение темы карты ----------
function applyMapTheme(theme) {
  state.mapType = theme;
  if (theme === 'west') {
    scene.background = new THREE.Color(0xbfe3ff);
    scene.fog = new THREE.FogExp2(0xdccfa4, 0.014);
    floor.material.color.setHex(0xc9ad7f);
    floor.material.roughness = 0.92;
    floor.material.metalness = 0.02;
    amb.color.setHex(0xfff2d6); amb.intensity = 0.7;
    key.color.setHex(0xfff4d0); key.intensity = 4.4; key.position.set(6, 11, 5);
    rim1.intensity = 0.5; rim2.intensity = 0.35;
    hemi.color.setHex(0xbfe3ff); hemi.groundColor.setHex(0xc9ad7f); hemi.intensity = 0.9;
    noirProps.visible = false;
    westProps.visible = true;
    dustMat.color.setHex(0xd9c08a); dustMat.size = 0.028; dustMat.opacity = 0.22;
  } else {
    scene.background = new THREE.Color(0x05070c);
    scene.fog = new THREE.FogExp2(0x05070c, 0.045);
    floor.material.color.setHex(0x11141c);
    floor.material.roughness = 0.25;
    floor.material.metalness = 0.3;
    amb.color.setHex(0x33405a); amb.intensity = 0.55;
    key.color.setHex(0xfff1de); key.intensity = 3.2; key.position.set(-3, 6, 2);
    rim1.intensity = 6; rim2.intensity = 5;
    hemi.intensity = 0.15;
    noirProps.visible = true;
    westProps.visible = false;
    dustMat.color.setHex(0x8899ff); dustMat.size = 0.02; dustMat.opacity = 0.35;
  }
}

// ---------- Конструктор гуманоида (более человечные пропорции + лицо) ----------
const SUIT = 0x0b0c10;
const SKIN = 0xcda37b;

function buildHumanoid(tieColor, theme) {
  const root = new THREE.Group();
  const isWest = theme === 'west';

  const suitColor = isWest ? 0x5b4530 : SUIT;
  const suitMat = new THREE.MeshStandardMaterial({ color: suitColor, roughness: isWest ? 0.8 : 0.45, metalness: isWest ? 0 : 0.15 });
  const skinMat = new THREE.MeshStandardMaterial({ color: SKIN, roughness: 0.6 });
  const tieMat = new THREE.MeshStandardMaterial({ color: tieColor, roughness: 0.35, metalness: 0.2 });

  const pelvis = new THREE.Group();
  pelvis.position.y = 0.95;
  root.add(pelvis);

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 0.55, 4, 8), suitMat);
  torso.position.y = 0.42;
  torso.castShadow = true;
  torso.name = 'torso';
  pelvis.add(torso);

  const tie = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.4, 0.02), tieMat);
  tie.position.set(0, 0.5, 0.24);
  tie.visible = !isWest;
  torso.add(tie);

  if (isWest) {
    const belt = new THREE.Mesh(new THREE.TorusGeometry(0.245, 0.028, 8, 20), new THREE.MeshStandardMaterial({ color: 0x3b2a1c, roughness: 0.75 }));
    belt.rotation.x = Math.PI / 2;
    belt.position.y = 0.13;
    torso.add(belt);
  }

  // Голова + лицо
  const headJoint = new THREE.Group();
  headJoint.position.set(0, 0.78, 0);
  pelvis.add(headJoint);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 20, 20), skinMat);
  head.castShadow = true;
  head.name = 'head';
  headJoint.add(head);

  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.3 });
  const eyeGeo = new THREE.SphereGeometry(0.018, 8, 8);
  const eyeL = new THREE.Mesh(eyeGeo, eyeMat); eyeL.position.set(-0.055, 0.01, 0.145); head.add(eyeL);
  const eyeR = new THREE.Mesh(eyeGeo, eyeMat); eyeR.position.set(0.055, 0.01, 0.145); head.add(eyeR);
  const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.012, 0.01), new THREE.MeshStandardMaterial({ color: 0x7a3b3b, roughness: 0.5 }));
  mouth.position.set(0, -0.075, 0.15); head.add(mouth);

  if (isWest) {
    const hatMat = new THREE.MeshStandardMaterial({ color: 0x4a3420, roughness: 0.7 });
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.27, 0.02, 20), hatMat);
    brim.position.set(0, 0.155, 0);
    head.add(brim);
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.14, 16), hatMat);
    crown.position.set(0, 0.24, 0);
    head.add(crown);
    const bandana = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.03, 8, 16), new THREE.MeshStandardMaterial({ color: tieColor, roughness: 0.6 }));
    bandana.rotation.x = Math.PI / 2;
    bandana.position.y = -0.06;
    headJoint.add(bandana);
    const mustache = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.02, 0.02), new THREE.MeshStandardMaterial({ color: 0x2c1c10 }));
    mustache.position.set(0, -0.045, 0.155);
    head.add(mustache);
  } else {
    const hairMat = new THREE.MeshStandardMaterial({ color: 0x14120f, roughness: 0.5 });
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.166, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), hairMat);
    hair.position.y = 0.02;
    head.add(hair);
  }

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

    const handMesh = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 10), skinMat);
    hand.add(handMesh);

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

    const bootMat = new THREE.MeshStandardMaterial({ color: isWest ? 0x3b2a1c : 0x08090c, roughness: 0.7 });
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.06, 0.24), bootMat);
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
    shootHand: 'right',
    limbState: { leftArm: true, rightArm: true, leftLeg: true, rightLeg: true },
    baseY: 0,
  };

  root.scale.setScalar(1.12);
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

const muzzleLight = new THREE.PointLight(0xffdca0, 0, 4, 2);
camera.add(muzzleLight);

// ---------- Кровь: система частиц + лужи ----------
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
  const pool = new THREE.Mesh(
    new THREE.CircleGeometry(0.06 + Math.random() * 0.05, 10),
    new THREE.MeshStandardMaterial({ color: 0x5c0a10, roughness: 0.2, metalness: 0.1, transparent: true, opacity: 0.85 })
  );
  pool.rotation.x = -Math.PI / 2;
  pool.position.set(position.x + (Math.random() - 0.5) * 0.3, 0.01, position.z + (Math.random() - 0.5) * 0.3);
  scene.add(pool);
}

// ---------- Отсоединяемые части тела ----------
const fallingParts = [];
function detachLimb(unit, limbKey) {
  const limbData = unit.userData;
  if (!limbData.limbState[limbKey]) return;
  limbData.limbState[limbKey] = false;

  const limbGroup = limbData.limbs[limbKey];
  const worldPos = new THREE.Vector3();
  limbGroup.getWorldPosition(worldPos);

  scene.attach(limbGroup);
  fallingParts.push({
    obj: limbGroup,
    vel: new THREE.Vector3((Math.random() - 0.5) * 1.2, 1.4 + Math.random(), (Math.random() - 0.5) * 1.2),
    angVel: new THREE.Vector3((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6),
    life: 0,
  });

  limbGroup.visible = true;
  spawnBlood(worldPos, 30);

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
  unit.userData.deathT = 0;
}

// ---------- Создание игрока и противника ----------
let playerUnit = buildHumanoid(0x333333, state.mapType);
playerUnit.visible = false;
playerUnit.position.set(0, 0, 4.6);
scene.add(playerUnit);

let enemyUnit = buildHumanoid(BOTS[0].tie, state.mapType);
enemyUnit.position.set(0, 0, -4.6);
enemyUnit.rotation.y = Math.PI;
scene.add(enemyUnit);

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

// ---------- Ввод: единая обработка мыши/тача через Pointer Events ----------
let dragging = false;
let activePointerId = null;
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

canvas.addEventListener('pointerdown', e => {
  activePointerId = e.pointerId;
  onPointerDown(e.clientX, e.clientY);
  try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
});
canvas.addEventListener('pointermove', e => {
  if (e.pointerId !== activePointerId) return;
  onPointerMove(e.clientX, e.clientY);
});
canvas.addEventListener('pointerup', e => {
  if (e.pointerId !== activePointerId) return;
  onPointerUp();
  activePointerId = null;
});
canvas.addEventListener('pointercancel', () => { onPointerUp(); activePointerId = null; });

// ---------- Кнопка выстрела: мгновенный и надёжный отклик с первого касания ----------
const fireBtn = document.getElementById('fire-btn');
function tryPlayerShoot() {
  if (state.screen !== 'duel' || state.duelPhase !== 'fight') return;
  if (bulletTimeActive) return;
  if (!enemyUnit.userData.alive) return;
  if (!state.playerLimbs.leftArm && !state.playerLimbs.rightArm) return;
  if (Date.now() - state.lastShotAt < 260) return;
  state.lastShotAt = Date.now();
  playerFire();
}
function firePointerDown(e) {
  e.preventDefault();
  e.stopPropagation();
  tryPlayerShoot();
}
fireBtn.addEventListener('pointerdown', firePointerDown, { passive: false });
addEventListener('keydown', e => { if (e.code === 'Space') tryPlayerShoot(); });

// ---------- Выстрел игрока ----------
const raycaster = new THREE.Raycaster();
function playerFire() {
  muzzleFlash(state.shootHand === 'right' ? fpGunRight : fpGunLeft);
  screenKick();
  playSound('shot');
  if (state.mode === 'online') sendOnline({ type: 'shot' });

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
  });
  Object.values(unit.userData.limbs).forEach(limbGroup => {
    if (unit.userData.limbState[limbGroup.userData.part]) {
      limbGroup.traverse(o => { if (o.isMesh && !list.includes(o)) list.push(o); });
    }
  });
  return list;
}

function findPartKeyFromMesh(mesh) {
  if (mesh.name === 'torso') return 'torso';
  if (mesh.name === 'head') return 'head';
  let p = mesh;
  while (p) {
    if (p.userData && p.userData.part) return p.userData.part;
    p = p.parent;
  }
  return null;
}

// ---------- Кинематографичный "пуля летит в голову" эффект ----------
let bulletTimeActive = false;
function playHeadshotBulletCam(fromPos, toPos, onDone) {
  bulletTimeActive = true;
  canvas.classList.add('bullet-time');

  const bulletMat = new THREE.MeshStandardMaterial({ color: 0xffe9a8, emissive: 0xffcf70, emissiveIntensity: 1.6, metalness: 0.9, roughness: 0.2 });
  const bullet = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.045, 8), bulletMat);
  bullet.position.copy(fromPos);
  const dir = new THREE.Vector3().subVectors(toPos, fromPos).normalize();
  bullet.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  scene.add(bullet);

  const trailMat = new THREE.MeshBasicMaterial({ color: 0xfff2c9, transparent: true, opacity: 0.5 });
  const trail = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 1, 6), trailMat);
  scene.add(trail);

  const startFov = camera.fov;
  const targetFov = 32;
  const duration = 620;
  const start = performance.now();

  function step(now) {
    const t = Math.min((now - start) / duration, 1);
    const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    bullet.position.lerpVectors(fromPos, toPos, ease);

    trail.position.lerpVectors(fromPos, bullet.position, 0.5);
    trail.scale.y = fromPos.distanceTo(bullet.position);
    trail.quaternion.copy(bullet.quaternion);
    trail.material.opacity = 0.5 * (1 - ease);

    const zoomT = Math.sin(Math.PI * Math.min(t * 1.15, 1));
    camera.fov = startFov + (targetFov - startFov) * zoomT;
    camera.updateProjectionMatrix();

    if (t < 1) {
      requestAnimationFrame(step);
    } else {
      scene.remove(bullet);
      scene.remove(trail);
      camera.fov = startFov;
      camera.updateProjectionMatrix();
      canvas.classList.remove('bullet-time');
      bulletTimeActive = false;
      onDone && onDone();
    }
  }
  requestAnimationFrame(step);
}

function resolveHit(unit, mesh, point) {
  const partKey = findPartKeyFromMesh(mesh);
  if (!partKey) return;
  playSound('hit');
  if (state.mode === 'online') sendOnline({ type: 'hit', part: partKey });

  if (partKey === 'head') {
    const gunObj = state.shootHand === 'right' ? fpGunRight : fpGunLeft;
    const fromPos = new THREE.Vector3();
    gunObj.getWorldPosition(fromPos);
    playHeadshotBulletCam(fromPos, point.clone(), () => {
      spawnBlood(point, 34);
      if (unit === enemyUnit) endRound(true); else endRound(false);
    });
    return;
  }

  spawnBlood(point, 18);

  if (partKey === 'torso') {
    if (unit === enemyUnit) endRound(true); else endRound(false);
    return;
  }
  if (unit === enemyUnit) {
    detachLimb(unit, partKey);
  } else {
    applyPlayerLimbHit(partKey);
  }
}

// ---------- Урон игроку от бота / соперника ----------
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
function enemyMuzzleFlash() {
  const eData = enemyUnit.userData;
  const gunObj = eData.shootHand === 'left' ? eData.guns.left : eData.guns.right;
  const pos = new THREE.Vector3();
  gunObj.getWorldPosition(pos);
  const light = new THREE.PointLight(0xffdca0, 6, 4, 2);
  light.position.copy(pos);
  scene.add(light);
  setTimeout(() => scene.remove(light), 60);
}
function screenKick() {
  camera.rotation.z += (Math.random() - 0.5) * 0.01;
}
const damageOverlay = document.getElementById('damage-overlay');
function flashDamage(strength = 0.55) {
  damageOverlay.style.opacity = strength;
  setTimeout(() => (damageOverlay.style.opacity = 0), 260);
}

// ---------- Звук через WebAudio ----------
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
  } catch (e) { /* аудио недоступно */ }
}

// ---------- Бот: ИИ ----------
function botFire(bot) {
  if (state.duelPhase !== 'fight') return;
  playSound('shot');
  const acc = bot.accuracy;
  const roll = Math.random();

  let partKey;
  const r = Math.random();
  if (r < acc * 0.6) partKey = Math.random() < 0.85 ? 'torso' : 'head';
  else {
    const limbs = ['leftArm', 'rightArm', 'leftLeg', 'rightLeg'].filter(k => state.playerLimbs[k]);
    partKey = limbs.length ? limbs[Math.floor(Math.random() * limbs.length)] : 'torso';
  }

  if (roll > acc + 0.15) return; // мимо

  const toPos = new THREE.Vector3();
  camera.getWorldPosition(toPos);

  if (partKey === 'head') {
    const eData = enemyUnit.userData;
    const gunObj = eData.shootHand === 'left' ? eData.guns.left : eData.guns.right;
    const fromPos = new THREE.Vector3();
    gunObj.getWorldPosition(fromPos);
    playHeadshotBulletCam(fromPos, toPos.clone(), () => {
      spawnBlood(toPos.clone().add(new THREE.Vector3(0, -0.05, -0.05)), 30);
      endRound(false);
    });
    return;
  }

  spawnBlood(toPos.clone().add(new THREE.Vector3(0, -0.2, -0.3)), 14);

  if (partKey === 'torso') {
    endRound(false);
  } else {
    applyPlayerLimbHit(partKey);
  }
}

// ---------- Управление раундом дуэли ----------
const hud = document.getElementById('hud');
const countdownEl = document.getElementById('countdown');

function startDuel(botIdx) {
  state.mode = 'bot';
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

  runCountdown();
}

function resetUnits() {
  scene.remove(playerUnit);
  scene.remove(enemyUnit);
  fallingParts.length = 0;
  bloodParticles.forEach(b => scene.remove(b.mesh));
  bloodParticles.length = 0;
  scene.children.filter(o => o.geometry && o.geometry.type === 'CircleGeometry').forEach(o => scene.remove(o));

  playerUnit = buildHumanoid(0x333333, state.mapType);
  playerUnit.visible = false;
  playerUnit.position.set(0, 0, 4.6);
  scene.add(playerUnit);

  const enemyTie = state.mode === 'online' ? 0x555555 : BOTS[state.botIndex].tie;
  enemyUnit = buildHumanoid(enemyTie, state.mapType);
  enemyUnit.position.set(0, 0, -4.6);
  enemyUnit.rotation.y = Math.PI;
  scene.add(enemyUnit);

  state.playerLimbs = { leftArm: true, rightArm: true, leftLeg: true, rightLeg: true, alive: true };
  playerLimping = false;
  state.shootHand = 'right';
  fpGunRight.visible = true;
  fpGunLeft.visible = false;
  camera.rotation.set(0, 0, 0);
  camera.fov = BASE_FOV;
  camera.updateProjectionMatrix();
  state.aimYaw = 0; state.aimPitch = 0;
  damageOverlay.style.opacity = 0;
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
      if (state.mode === 'bot') scheduleBotShot();
    }
  }, 700);
}

function scheduleBotShot() {
  const bot = state.bot;
  const delay = bot.reaction[0] + Math.random() * (bot.reaction[1] - bot.reaction[0]);
  setTimeout(() => {
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

  if (state.mode === 'online') {
    document.getElementById('result-sub').textContent = won
      ? 'Соперник повержен.'
      : 'Соперник оказался быстрее.';
  } else {
    document.getElementById('result-sub').textContent = won
      ? `${state.bot.name} повержен.`
      : `${state.bot.name} оказался быстрее.`;
    reportGamePlayed(won);
  }
}

document.getElementById('btn-menu').addEventListener('click', () => {
  resultPanel.classList.add('hidden');
  document.getElementById('menu').classList.remove('hidden');
  state.screen = 'menu';
});
document.getElementById('btn-retry').addEventListener('click', () => {
  if (state.mode === 'online') startFindOnline();
  else startDuel(state.botIndex);
});

document.querySelectorAll('.bot-card').forEach((card, idx) => {
  card.addEventListener('click', () => startDuel(idx));
});

// ---------- Переключатель карты в меню ----------
const mapButtons = {
  west: document.getElementById('map-west'),
  noir: document.getElementById('map-noir'),
};
function refreshMapButtons() {
  Object.entries(mapButtons).forEach(([k, el]) => el && el.classList.toggle('active', state.mapType === k));
}
if (mapButtons.west) mapButtons.west.addEventListener('click', () => { applyMapTheme('west'); refreshMapButtons(); });
if (mapButtons.noir) mapButtons.noir.addEventListener('click', () => { applyMapTheme('noir'); refreshMapButtons(); });
applyMapTheme(state.mapType);
refreshMapButtons();

// ---------- Онлайн-счётчик, число сыгранных дуэлей и PvP-матчмейкинг ----------
let ws;
function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  try {
    ws = new WebSocket(`${proto}://${location.host}`);
    ws.onmessage = ev => {
      let data;
      try { data = JSON.parse(ev.data); } catch { return; }

      switch (data.type) {
        case 'stats':
          document.getElementById('online-count').textContent = data.online;
          document.getElementById('played-count').textContent = data.played;
          break;
        case 'duel_found':
          startOnlineDuel();
          break;
        case 'duel_start':
          runCountdown();
          break;
        case 'opponent_shot':
          enemyMuzzleFlash();
          playSound('shot');
          break;
        case 'you_were_hit':
          if (data.part === 'head' || data.part === 'torso') {
            endRound(false);
          } else {
            applyPlayerLimbHit(data.part);
          }
          break;
        case 'opponent_left':
          handleOpponentLeft();
          break;
      }
    };
    ws.onclose = () => setTimeout(connectWS, 2000);
  } catch (e) { /* нет сети */ }
}
connectWS();

function sendOnline(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

function reportGamePlayed(won) {
  sendOnline({ type: 'game_played', won });
}

function handleOpponentLeft() {
  if (state.screen !== 'duel' || state.duelPhase === 'resolved') return;
  state.duelPhase = 'resolved';
  hud.classList.add('hidden');
  resultPanel.classList.remove('hidden');
  document.getElementById('result-title').textContent = 'СОПЕРНИК ОТКЛЮЧИЛСЯ';
  document.getElementById('result-title').style.color = '#9aa';
  document.getElementById('result-sub').textContent = 'Матч прерван раньше времени.';
}

function startFindOnline() {
  document.getElementById('waiting-overlay').classList.remove('hidden');
  sendOnline({ type: 'find_duel' });
}
function cancelFindOnline() {
  document.getElementById('waiting-overlay').classList.add('hidden');
  sendOnline({ type: 'cancel_find' });
}
function startOnlineDuel() {
  document.getElementById('waiting-overlay').classList.add('hidden');
  state.mode = 'online';
  resetUnits();

  enemyUnit.remove(enemyLabel);
  enemyLabel = makeLabel('Соперник');
  enemyUnit.add(enemyLabel);

  state.screen = 'duel';
  document.getElementById('menu').classList.add('hidden');
  document.getElementById('result').classList.add('hidden');
  hud.classList.remove('hidden');

  sendOnline({ type: 'ready' });
}

document.getElementById('btn-online').addEventListener('click', startFindOnline);
document.getElementById('btn-cancel-find').addEventListener('click', cancelFindOnline);

// ---------- Основной цикл рендера ----------
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);

  camera.rotation.order = 'YXZ';
  camera.rotation.y += (state.aimYaw - camera.rotation.y) * 0.25;
  camera.rotation.x += (state.aimPitch - camera.rotation.x) * 0.25;

  const bobT = performance.now() / 1000;
  const limpOffset = playerLimping ? Math.sin(bobT * 5) * 0.05 : Math.sin(bobT * 1.2) * 0.006;
  camera.position.y = 1.7 + limpOffset;
  if (playerLimping) camera.rotation.z += Math.sin(bobT * 5) * 0.002;

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

  if (enemyUnit) {
    const eData = enemyUnit.userData;
    if (eData.limping) {
      const tilt = 0.18;
      eData.pelvis.rotation.z += (tilt - eData.pelvis.rotation.z) * 0.08;
    }
    if (!eData.alive) {
      eData.deathT = (eData.deathT || 0) + dt;
      const t = Math.min(eData.deathT / 0.9, 1);
      eData.pelvis.rotation.x = t * 1.35;
      eData.pelvis.position.y = 0.95 * (1 - t * 0.85);
    }
  }
  if (playerUnit && playerLimping) {
    playerUnit.userData.pelvis.rotation.z += (0.18 - playerUnit.userData.pelvis.rotation.z) * 0.08;
  }

  dust.rotation.y += dt * 0.01;

  renderer.render(scene, camera);
}
animate();

window.__duel = { state, startDuel, applyMapTheme };