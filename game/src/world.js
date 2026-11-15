// Neon Bazaar — the map: Lantern Row, a rain-soaked night market.
// Two sites (Spice Court north, Lantern Plaza south), a mid plaza with the
// Longshot pedestal, a north lane (Noodle Alley) and a south lane (Silk
// Alley). Everything the eye sees is built here from boxes, canvas-texture
// signs and a handful of lights; everything the simulation touches (the
// collider list, the waypoints, the sites, the spawns) comes back in the
// object buildWorld returns.

import * as THREE from 'three';
import { PALETTE, SIGNS } from './palette.js';

const geoCache = new Map();
function boxGeo(w, h, d) {
  const key = `${w}|${h}|${d}`;
  let g = geoCache.get(key);
  if (!g) {
    g = new THREE.BoxGeometry(w, h, d);
    geoCache.set(key, g);
  }
  return g;
}

const matCache = new Map();
function lambert(color, emissive = 0x000000, emissiveIntensity = 1) {
  const key = `${color}|${emissive}|${emissiveIntensity}`;
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color, emissive, emissiveIntensity });
    matCache.set(key, m);
  }
  return m;
}

/** A glowing neon sign drawn on a canvas: big characters, latin subtitle. */
function signTexture(sign) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = sign.bg;
  g.fillRect(0, 0, 256, 128);
  g.strokeStyle = sign.color;
  g.lineWidth = 4;
  g.strokeRect(4, 4, 248, 120);
  g.textAlign = 'center';
  g.shadowColor = sign.color;
  g.shadowBlur = 18;
  g.fillStyle = sign.color;
  g.font = 'bold 56px sans-serif';
  g.fillText(sign.text, 128, 66);
  g.shadowBlur = 8;
  g.font = 'bold 22px sans-serif';
  g.fillText(sign.sub, 128, 104);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** A soft round sprite texture for steam and lantern glow. */
function glowTexture() {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export function buildWorld(scene) {
  const colliders = [];
  const lanterns = [];
  const steams = [];
  let flickerMat = null;
  let pedestalRing = null;
  let railgunMesh = null;
  let pedestalLight = null;

  const addCollider = (x, z, w, d, h, y = 0) => {
    colliders.push({ minX: x - w / 2, maxX: x + w / 2, minY: y, maxY: y + h, minZ: z - d / 2, maxZ: z + d / 2 });
  };
  const addBox = (x, y, z, w, h, d, mat, collide = true) => {
    const mesh = new THREE.Mesh(boxGeo(w, h, d), mat);
    mesh.position.set(x, y + h / 2, z);
    scene.add(mesh);
    if (collide) addCollider(x, z, w, d, h, y);
    return mesh;
  };

  // Sky, fog and the moon. The fog is what makes the far stalls melt into
  // the night instead of ending in a hard black wall.
  scene.background = new THREE.Color(PALETTE.night);
  scene.fog = new THREE.FogExp2(PALETTE.fog, 0.012);
  const hemi = new THREE.HemisphereLight(0x8fa3d9, 0x1a1410, 0.85);
  scene.add(hemi);
  // A low ambient lift so the ground and the crates never go fully black.
  scene.add(new THREE.AmbientLight(0x223044, 0.55));
  const moon = new THREE.DirectionalLight(PALETTE.moon, 0.7);
  moon.position.set(-20, 30, -12);
  scene.add(moon);

  // Stars: one static Points cloud, far above the roofs.
  {
    const n = 260;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 220;
      pos[i * 3 + 1] = 28 + Math.random() * 50;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 220;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0xcdd8ff, size: 0.7, sizeAttenuation: false, fog: false })));
  }

  // Wet ground: a dark phong floor so the neon and lanterns smear a little.
  {
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(70, 54),
      new THREE.MeshPhongMaterial({ color: PALETTE.ground, shininess: 70, specular: 0x33415e }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, 0, 0);
    scene.add(ground);
    // Puddles: flat, lighter planes that catch the lights.
    const puddleMat = new THREE.MeshPhongMaterial({ color: 0x2e3a5e, shininess: 120, specular: 0x6a86b8 });
    for (const [x, z, w, d] of [[-6, -3, 5, 3], [9, 7, 4, 2.5], [-20, 8, 4, 3], [18, -12, 5, 2], [2, -16, 3, 2]]) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(w, d), puddleMat);
      p.rotation.x = -Math.PI / 2;
      p.position.set(x, 0.02, z);
      scene.add(p);
    }
  }

  // Outer walls: high enough that no jump or sightline leaves the market.
  addBox(0, 0, -24.5, 66, 5, 1, lambert(PALETTE.wall));
  addBox(0, 0, 24.5, 66, 5, 1, lambert(PALETTE.wall));
  addBox(-32.5, 0, 0, 1, 5, 50, lambert(PALETTE.wallDark));
  addBox(32.5, 0, 0, 1, 5, 50, lambert(PALETTE.wallDark));

  // Rooftop silhouettes past the walls, so the skyline is not flat.
  for (const [x, z, w, h, d] of [[-20, -30, 16, 9, 6], [8, -31, 20, 12, 6], [24, 30, 14, 8, 6], [-12, 31, 18, 10, 6]]) {
    const m = new THREE.Mesh(boxGeo(w, h, d), lambert(0x141828));
    m.position.set(x, h / 2, z);
    scene.add(m);
  }

  // --- Market stalls: a counter, a striped awning on poles, a neon sign.
  // The awning stripes are painted boxes; the sign is a canvas texture.
  function stall(x, z, rotY, signIndex, cloth) {
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    group.rotation.y = rotY;
    const counter = new THREE.Mesh(boxGeo(2.6, 1.05, 1.3), lambert(PALETTE.wood));
    counter.position.y = 0.525;
    group.add(counter);
    const top = new THREE.Mesh(boxGeo(2.8, 0.08, 1.5), lambert(PALETTE.woodDark));
    top.position.y = 1.1;
    group.add(top);
    // Awning: alternating cloth stripes, tilted.
    for (let i = 0; i < 5; i++) {
      const stripe = new THREE.Mesh(boxGeo(0.56, 0.05, 1.7), lambert(i % 2 === 0 ? cloth : 0xe8ddc0));
      stripe.position.set(-1.12 + i * 0.56, 2.35 - Math.abs(i - 2) * 0.06, 0);
      stripe.rotation.x = -0.18;
      group.add(stripe);
    }
    for (const px of [-1.25, 1.25]) {
      const pole = new THREE.Mesh(boxGeo(0.08, 2.3, 0.08), lambert(PALETTE.metal));
      pole.position.set(px, 1.15, 0.7);
      group.add(pole);
    }
    // Goods on the counter: little coloured boxes.
    const goods = [0xff2e88, 0xffb347, 0x3fae7a, 0x2ee6d6];
    for (let i = 0; i < 4; i++) {
      const item = new THREE.Mesh(boxGeo(0.34, 0.3, 0.34), lambert(goods[i % goods.length]));
      item.position.set(-0.9 + i * 0.6, 1.3, (i % 2 === 0 ? -0.25 : 0.25));
      group.add(item);
    }
    // The sign hangs above the awning.
    const sign = SIGNS[signIndex % SIGNS.length];
    const tex = signTexture(sign);
    const signMat = new THREE.MeshBasicMaterial({ map: tex });
    const signMesh = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.1), signMat);
    signMesh.position.set(0, 3.1, 0);
    group.add(signMesh);
    scene.add(group);
    // The stall blocks movement as one box (counter footprint).
    const cos = Math.abs(Math.cos(rotY));
    const sin = Math.abs(Math.sin(rotY));
    const w = 2.6 * cos + 1.3 * sin;
    const d = 2.6 * sin + 1.3 * cos;
    colliders.push({ minX: x - w / 2, maxX: x + w / 2, minY: 0, maxY: 1.15, minZ: z - d / 2, maxZ: z + d / 2 });
    if (signIndex === 1) flickerMat = signMat; // the RAMEN sign flickers
    return group;
  }

  // Stall rows along the two lanes, facing the street.
  stall(-8, -19, 0, 1, PALETTE.clothRed);
  stall(4, -19, 0, 2, PALETTE.clothTeal);
  stall(16, -19, 0, 6, PALETTE.clothGold);
  stall(-8, 19, Math.PI, 3, PALETTE.clothTeal);
  stall(4, 19, Math.PI, 5, PALETTE.clothRed);
  stall(16, 19, Math.PI, 0, PALETTE.clothGold);
  // Two food carts with steam, near mid.
  stall(-6, 6, Math.PI / 2, 6, PALETTE.clothRed);
  stall(8, -6, -Math.PI / 2, 1, PALETTE.clothTeal);

  // --- Solid blocks: tea house and silk house frame the mid plaza.
  addBox(6, 0, -10, 8, 3.4, 5, lambert(PALETTE.wallDark));
  addBox(6, 0, 10, 8, 3.4, 5, lambert(PALETTE.wallDark));
  // Roof rims on the two houses, in lantern amber.
  addBox(6, 3.4, -10, 8.6, 0.25, 5.6, lambert(PALETTE.lantern, PALETTE.lantern, 0.7));
  addBox(6, 3.4, 10, 8.6, 0.25, 5.6, lambert(PALETTE.lantern, PALETTE.lantern, 0.7));
  // Mid fountain: a low round planter (collider as a box).
  {
    const f = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 2.3, 0.9, 12), lambert(0x3a415c));
    f.position.set(-3, 0.45, 0);
    scene.add(f);
    colliders.push({ minX: -5.1, maxX: -0.9, minY: 0, maxY: 0.9, minZ: -2.1, maxZ: 2.1 });
    const water = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 1.9, 0.1, 12), new THREE.MeshPhongMaterial({ color: 0x1d4e5e, shininess: 140, specular: 0x88bbcc }));
    water.position.set(-3, 0.92, 0);
    scene.add(water);
  }

  // --- Crates and barrels: low cover dotted through the lanes.
  const crateMat = lambert(PALETTE.crate);
  const barrelMat = lambert(0x5e3a3a);
  function crate(x, z, s = 1.2, y = 0) {
    const m = new THREE.Mesh(boxGeo(s, s, s), crateMat);
    m.position.set(x, y + s / 2, z);
    m.rotation.y = (x * 7 + z * 13) % 0.6;
    scene.add(m);
    addCollider(x, z, s, s, s, y);
  }
  function barrel(x, z) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 1.1, 10), barrelMat);
    m.position.set(x, 0.55, z);
    scene.add(m);
    addCollider(x, z, 0.9, 0.9, 1.1);
  }
  crate(-12, -6);
  crate(-11, -6, 1.2, 1.2);
  crate(10, -4);
  crate(-4, 12);
  crate(-4, 13.2, 1.0, 0);
  crate(14, 8);
  crate(-20, 4);
  crate(20, -8);
  crate(20, -6.8, 1.0, 0);
  crate(-24, -6);
  crate(24, 6);
  crate(2, -14);
  crate(2, 14);
  barrel(-14, -2);
  barrel(16, 2);
  barrel(-18, 12);
  barrel(22, -14);

  // --- Lantern posts: a pole, a swaying paper lantern, a warm point light
  // on the four posts that matter most (the plaza corners).
  const glowTex = glowTexture();
  function lanternPost(x, z, lit) {
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    const pole = new THREE.Mesh(boxGeo(0.12, 4.2, 0.12), lambert(PALETTE.metal));
    pole.position.y = 2.1;
    group.add(pole);
    const arm = new THREE.Mesh(boxGeo(1.1, 0.08, 0.08), lambert(PALETTE.metal));
    arm.position.set(0.5, 4.1, 0);
    group.add(arm);
    const lamp = new THREE.Group();
    lamp.position.set(1.0, 3.9, 0);
    const shade = new THREE.Mesh(new THREE.SphereGeometry(0.34, 10, 8), lambert(PALETTE.lantern, PALETTE.lantern, 0.9));
    shade.scale.y = 1.25;
    lamp.add(shade);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xffb347, transparent: true, opacity: 0.35, depthWrite: false }));
    halo.scale.set(1.1, 1.1, 1);
    lamp.add(halo);
    group.add(lamp);
    lanterns.push({ group: lamp, phase: x * 1.7 + z * 2.3 });
    if (lit) {
      const light = new THREE.PointLight(0xffb347, 12, 14, 1.6);
      light.position.set(x + 1, 3.6, z);
      scene.add(light);
    }
    scene.add(group);
  }
  lanternPost(0, -12, true);
  lanternPost(0, 12, true);
  lanternPost(-12, 0, false);
  lanternPost(12, 0, true);
  lanternPost(-24, -12, false);
  lanternPost(-24, 12, false);
  lanternPost(24, -12, false);
  lanternPost(24, 12, true);
  lanternPost(-16, -15, false);
  lanternPost(-16, 15, false);

  // --- Neon wall signs on the outer walls, facing the street.
  function wallSign(x, z, rotY, signIndex, w = 3.4) {
    const sign = SIGNS[signIndex % SIGNS.length];
    const tex = signTexture(sign);
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(w, w / 2),
      new THREE.MeshBasicMaterial({ map: tex }),
    );
    mesh.position.set(x, 3.4, z);
    mesh.rotation.y = rotY;
    scene.add(mesh);
  }
  wallSign(-14, -23.9, 0, 0, 5);
  wallSign(14, -23.9, 0, 4);
  wallSign(-14, 23.9, Math.PI, 7);
  wallSign(14, 23.9, Math.PI, 3);
  wallSign(-31.9, -8, Math.PI / 2, 2);
  wallSign(31.9, 8, -Math.PI / 2, 5);

  // --- The two sites: a glowing outline on the ground and a hanging letter.
  function siteMarker(cx, cz, letter, color) {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.75 });
    const t = 0.18;
    const w = 8;
    const d = 7;
    for (const [x, z, ww, dd] of [
      [cx, cz - d / 2, w, t],
      [cx, cz + d / 2, w, t],
      [cx - w / 2, cz, t, d],
      [cx + w / 2, cz, t, d],
    ]) {
      const strip = new THREE.Mesh(new THREE.PlaneGeometry(ww, dd), mat);
      strip.rotation.x = -Math.PI / 2;
      strip.position.set(x, 0.03, z);
      scene.add(strip);
    }
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 128;
    const g = c.getContext('2d');
    g.textAlign = 'center';
    g.shadowColor = '#2ee6d6';
    g.shadowBlur = 24;
    g.fillStyle = '#e8fffb';
    g.font = 'bold 92px sans-serif';
    g.fillText(letter, 64, 96);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    sprite.scale.set(2.4, 2.4, 1);
    sprite.position.set(cx, 4.6, cz);
    scene.add(sprite);
  }
  siteMarker(-16, -15, 'A', PALETTE.neonCyan);
  siteMarker(-16, 15, 'B', PALETTE.neonCyan);

  // Spice sacks at site A, lantern cluster at site B.
  for (const [x, z, col] of [[-19, -17, 0xc25e2e], [-13, -17, 0xd9a441], [-19, -13, 0x7a4a8e], [-13, -13, 0xb03a3a]]) {
    const sack = new THREE.Mesh(new THREE.SphereGeometry(0.55, 8, 6), lambert(col));
    sack.scale.y = 0.75;
    sack.position.set(x, 0.4, z);
    scene.add(sack);
    addCollider(x, z, 1.0, 1.0, 0.8);
  }
  for (const [x, z] of [[-19, 13], [-13, 13], [-19, 17], [-13, 17]]) {
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.4, 10, 8), lambert(PALETTE.lantern, PALETTE.lantern, 1));
    lamp.scale.y = 1.3;
    lamp.position.set(x, 2.6, z);
    scene.add(lamp);
  }

  // --- The Longshot pedestal at the mid plaza. The railgun itself only
  // appears on power rounds; the ring pulses so the eye finds it.
  {
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.1, 0.5, 12), lambert(0x39415e));
    base.position.set(0, 0.25, 0);
    scene.add(base);
    colliders.push({ minX: -1.1, maxX: 1.1, minY: 0, maxY: 0.5, minZ: -1.1, maxZ: 1.1 });
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(1.35, 0.07, 8, 32),
      new THREE.MeshBasicMaterial({ color: PALETTE.railgun }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(0, 0.06, 0);
    scene.add(ring);
    pedestalRing = ring;
    const light = new THREE.PointLight(PALETTE.railgun, 0, 12, 1.8);
    light.position.set(0, 2, 0);
    scene.add(light);
    pedestalLight = light;
    // The railgun: a long barrel, a body, a glowing cell.
    const gun = new THREE.Group();
    const body = new THREE.Mesh(boxGeo(0.16, 0.22, 1.5), lambert(0x2a2f45));
    gun.add(body);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.1, 8), lambert(PALETTE.railgun, PALETTE.railgun, 1));
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.08, -1.1);
    gun.add(barrel);
    const cell = new THREE.Mesh(boxGeo(0.1, 0.1, 0.4), new THREE.MeshBasicMaterial({ color: PALETTE.railgun }));
    cell.position.set(0, -0.02, 0.3);
    gun.add(cell);
    gun.position.set(0, 1.25, 0);
    gun.rotation.y = 0.6;
    gun.visible = false;
    scene.add(gun);
    railgunMesh = gun;
  }

  // --- Rain: one LineSegments cloud, recycled as the drops fall.
  const RAIN_DROPS = 320;
  const rainPos = new Float32Array(RAIN_DROPS * 6);
  const rainVel = new Float32Array(RAIN_DROPS);
  for (let i = 0; i < RAIN_DROPS; i++) {
    const x = (Math.random() - 0.5) * 64;
    const z = (Math.random() - 0.5) * 48;
    const y = Math.random() * 14;
    rainPos[i * 6] = x;
    rainPos[i * 6 + 1] = y;
    rainPos[i * 6 + 2] = z;
    rainPos[i * 6 + 3] = x;
    rainPos[i * 6 + 4] = y - 0.55;
    rainPos[i * 6 + 5] = z;
    rainVel[i] = 9 + Math.random() * 5;
  }
  const rainGeo = new THREE.BufferGeometry();
  rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
  const rain = new THREE.LineSegments(rainGeo, new THREE.LineBasicMaterial({ color: 0x8fa3d9, transparent: true, opacity: 0.35 }));
  scene.add(rain);

  // --- Steam over the two food carts.
  for (const [x, z] of [[-6, 6], [8, -6]]) {
    for (let i = 0; i < 3; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xcfd6e6, transparent: true, opacity: 0.25, depthWrite: false }));
      s.position.set(x + (i - 1) * 0.5, 1.6, z);
      s.scale.set(0.9, 0.9, 1);
      scene.add(s);
      steams.push({ sprite: s, baseY: 1.6, phase: i * 2.1 + x });
    }
  }

  // --- Waypoints: the graph the bots walk. Nodes sit in open ground; the
  // links are the lanes a bot may take. Routes are found by BFS in nav.js.
  const waypoints = {
    vgSpawn: { x: -28, z: 0, links: ['midWest', 'northWest', 'southWest'] },
    jkSpawn: { x: 28, z: 0, links: ['midEast', 'northEast', 'southEast'] },
    midWest: { x: -12, z: 0, links: ['vgSpawn', 'mid', 'midNorth', 'midSouth', 'aEntry', 'bEntry'] },
    midEast: { x: 12, z: 0, links: ['jkSpawn', 'mid', 'midNorth', 'midSouth', 'northEast', 'southEast'] },
    mid: { x: 3.5, z: 0, links: ['midWest', 'midEast', 'midNorth', 'midSouth'] },
    midNorth: { x: 0, z: -12, links: ['mid', 'midWest', 'midEast', 'northMid'] },
    midSouth: { x: 0, z: 12, links: ['mid', 'midWest', 'midEast', 'southMid'] },
    northWest: { x: -22, z: -19, links: ['vgSpawn', 'northMid', 'aEntry'] },
    northMid: { x: 0, z: -19, links: ['northWest', 'northEast', 'midNorth'] },
    northEast: { x: 20, z: -19, links: ['jkSpawn', 'northMid', 'midEast'] },
    southWest: { x: -22, z: 19, links: ['vgSpawn', 'southMid', 'bEntry'] },
    southMid: { x: 0, z: 19, links: ['southWest', 'southEast', 'midSouth'] },
    southEast: { x: 20, z: 19, links: ['jkSpawn', 'southMid', 'midEast'] },
    aEntry: { x: -12, z: -15, links: ['midWest', 'northWest', 'aSite', 'aHold2'] },
    aSite: { x: -16, z: -15, links: ['aEntry', 'aHold1', 'aHold3'] },
    aHold1: { x: -22, z: -15, links: ['aSite', 'aHold3'] },
    aHold2: { x: -18, z: -10, links: ['aEntry', 'midWest'] },
    aHold3: { x: -24, z: -18, links: ['aSite', 'aHold1'] },
    bEntry: { x: -12, z: 15, links: ['midWest', 'southWest', 'bSite', 'bHold2'] },
    bSite: { x: -16, z: 15, links: ['bEntry', 'bHold1', 'bHold3'] },
    bHold1: { x: -22, z: 15, links: ['bSite', 'bHold3'] },
    bHold2: { x: -18, z: 10, links: ['bEntry', 'midWest'] },
    bHold3: { x: -24, z: 18, links: ['bSite', 'bHold1'] },
  };

  const sites = {
    A: { cx: -16, cz: -15, w: 8, d: 7, plantX: -16, plantZ: -15 },
    B: { cx: -16, cz: 15, w: 8, d: 7, plantX: -16, plantZ: 15 },
  };
  const spawns = {
    VG: [
      { x: -28, z: -3, yaw: -Math.PI / 2 },
      { x: -28, z: 3, yaw: -Math.PI / 2 },
      { x: -26, z: -6, yaw: -Math.PI / 2 },
      { x: -26, z: 6, yaw: -Math.PI / 2 },
    ],
    JK: [
      { x: 28, z: -3, yaw: Math.PI / 2 },
      { x: 28, z: 3, yaw: Math.PI / 2 },
      { x: 26, z: -6, yaw: Math.PI / 2 },
      { x: 26, z: 6, yaw: Math.PI / 2 },
    ],
  };

  // Per-frame ambience: rain falls, lanterns sway, steam rises, the RAMEN
  // sign flickers, the pedestal ring breathes.
  function update(dt, t, powerRound, railgunVisible) {
    const pos = rainGeo.attributes.position.array;
    for (let i = 0; i < RAIN_DROPS; i++) {
      let y = pos[i * 6 + 1] - rainVel[i] * dt;
      if (y < 0) y += 14;
      pos[i * 6 + 1] = y;
      pos[i * 6 + 4] = y - 0.55;
    }
    rainGeo.attributes.position.needsUpdate = true;
    for (const l of lanterns) l.group.rotation.z = Math.sin(t * 0.9 + l.phase) * 0.12;
    for (const s of steams) {
      const cyc = (t * 0.35 + s.phase) % 1;
      s.sprite.position.y = s.baseY + cyc * 1.6;
      s.sprite.material.opacity = 0.28 * (1 - cyc);
      const sc = 0.7 + cyc * 0.9;
      s.sprite.scale.set(sc, sc, 1);
    }
    if (flickerMat) {
      const on = Math.sin(t * 13.7) > -0.86;
      flickerMat.color.setScalar(on ? 1 : 0.25);
    }
    if (pedestalRing) {
      const pulse = 0.75 + Math.sin(t * 2.4) * 0.25;
      pedestalRing.material.opacity = 1;
      pedestalRing.scale.setScalar(pulse);
      pedestalLight.intensity = powerRound ? 14 + Math.sin(t * 3) * 4 : 4;
    }
    if (railgunMesh) {
      railgunMesh.visible = railgunVisible;
      if (railgunVisible) {
        railgunMesh.position.y = 1.25 + Math.sin(t * 1.8) * 0.12;
        railgunMesh.rotation.y += dt * 0.7;
      }
    }
  }

  return { colliders, waypoints, sites, spawns, update };
}
