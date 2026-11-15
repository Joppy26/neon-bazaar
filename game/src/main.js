// Neon Bazaar — entry point. Boots the renderer, the world and the state,
// then runs the fixed-step simulation (60 Hz, apart from rendering) and
// draws it. This file also owns the player trigger, the camera, the
// viewmodel gun and the staged screenshot poses (?shot=start|play|site|end),
// which render real game state so the screenshots are honest.

import * as THREE from 'three';
import { freshState, PHASE } from './state.js';
import { buildWorld } from './world.js';
import { createActor, syncMesh, eyePos, ACTOR } from './actors.js';
import { stepPlayer, currentSpread } from './player.js';
import { WEAPONS } from './weapons.js';
import { createCombat } from './combat.js';
import { stepBot } from './bots.js';
import { setupMatch, startRound, stepRound, buyItem } from './rounds.js';
import { createHud } from './hud.js';
import { createInput } from './input.js';
import { createAudio } from './audio.js';
import { makeRng, clamp } from './util.js';

const DT = 1 / 60;
const params = new URLSearchParams(location.search);
const shotMode = params.get('shot');
const shotSeed = Number(params.get('seed') ?? 1);
const diag = document.getElementById('diag');

window.addEventListener('error', (e) => {
  diag.textContent = `ERROR: ${e.message}`;
  window.__gameError = e.message;
});

const state = freshState();
state.shotMode = !!shotMode;
const audio = createAudio();
const input = createInput(document.getElementById('game'));
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.1, 220);
camera.rotation.order = 'YXZ';

const world = buildWorld(scene);
state.sites = world.sites;

const hud = createHud(state);
const combat = createCombat(scene, state, audio, {
  onHit: (headshot, kill) => hud.showHit(headshot, kill),
  onHurt: () => hud.showDamage(),
  onDeath: () => {
    state.spectate = nearestAliveTeammate();
  },
  onFlash: (seconds) => hud.showFlash(seconds),
  onShake: (seconds) => hud.showShake(seconds),
});
combat.setColliders(world.colliders);

setupMatch(state, world, scene);
const player = state.actors[0];
player.name = 'You';

function nearestAliveTeammate() {
  for (const a of state.actors) {
    if (a.team === 'VG' && a.alive && !a.isPlayer) return a.id;
  }
  return null;
}

// --- Viewmodel: the gun the player sees, with a muzzle flash quad.
const viewGun = new THREE.Group();
{
  const dark = new THREE.MeshLambertMaterial({ color: 0x39415e });
  const accent = new THREE.MeshBasicMaterial({ color: 0x2ee6d6 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.13, 0.55), dark);
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.34), dark);
  barrel.position.set(0, 0.03, -0.42);
  const tip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.02, 0.06), accent);
  tip.position.set(0, 0.055, -0.58);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.18, 0.1), dark);
  grip.position.set(0, -0.14, 0.12);
  grip.rotation.x = 0.35;
  viewGun.add(body, barrel, tip, grip);
  viewGun.scale.setScalar(0.5);
  viewGun.position.set(0.32, -0.3, -1.0);
  camera.add(viewGun);
  scene.add(camera);
}
const flashQuad = new THREE.Mesh(
  new THREE.PlaneGeometry(0.3, 0.3),
  new THREE.MeshBasicMaterial({ color: 0xffd88a, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }),
);
flashQuad.position.set(0, 0.03, -0.62);
viewGun.add(flashQuad);
let flashQuadT = 0;

// --- Player trigger state.
let recoil = 0;
let prevFiring = false;
let walkPhase = 0;
let started = false;
let lastPhase = state.phase;
let bannerT = 0;

const playButton = document.getElementById('play');
playButton.addEventListener('click', () => {
  if (state.phase === PHASE.MATCH) {
    location.reload();
    return;
  }
  audio.ensure();
  hud.overlay.hidden = true;
  input.requestLock();
  started = true;
});
hud.overlay.hidden = false;

// ?autoplay=1 — headless smoke-test hook: start the match without a click
// and run the sim unlocked, so bots play full rounds on their own.
const autoplay = params.get('autoplay') === '1';
if (autoplay && !shotMode) {
  hud.overlay.hidden = true;
  started = true;
}

hud.onBuy = (id) => {
  buyItem(state, player, id, audio);
};
hud.buyMenu.addEventListener('click', (e) => {
  if (e.target === hud.buyMenu) hud.buyMenu.hidden = true;
});

function switchWeapon(slot) {
  const order = ['pistol', 'smg', 'rifle', 'marksman', 'railgun'];
  const id = order[slot - 1];
  if (!id || !player.weapons[id] || player.reloadT > 0) return;
  player.weapon = id;
  player.spreadHeat = 0;
  player.fireT = 0;
}

function tryFire() {
  const weapon = WEAPONS[player.weapon];
  const ammo = player.ammo[player.weapon];
  if (player.reloadT > 0 || player.fireT > 0) return;
  if (!ammo || ammo.mag <= 0) {
    audio.dryFire();
    startReload();
    return;
  }
  ammo.mag--;
  player.fireT = weapon.interval;
  player.spreadHeat = Math.min(2.5, player.spreadHeat + weapon.heat);
  recoil += weapon.kick;
  flashQuadT = 0.05;
  eyePos(player, _eye);
  const dir = cameraDir();
  const moving = Math.hypot(player.vx, player.vz) > 0.8;
  const spread = currentSpread(player, weapon, input.aiming, moving, player.onGround ? 0 : 1);
  combat.fire(player, weapon, _eye.x, _eye.y, _eye.z, dir.x, dir.y, dir.z, Math.random, spread);
}

const _eye = { x: 0, y: 0, z: 0 };
function cameraDir() {
  const cp = Math.cos(player.pitch);
  return {
    x: -Math.sin(player.yaw) * cp,
    y: Math.sin(player.pitch),
    z: -Math.cos(player.yaw) * cp,
  };
}

function startReload() {
  const weapon = WEAPONS[player.weapon];
  const ammo = player.ammo[player.weapon];
  if (player.reloadT > 0 || !ammo || ammo.reserve <= 0 || ammo.mag >= weapon.mag) return;
  player.reloadT = weapon.reload;
  audio.reload();
}

function throwSelectedGrenade() {
  for (const kind of ['frag', 'smoke', 'flash']) {
    if (player.grenades[kind] > 0) {
      const dir = cameraDir();
      combat.throwGrenade(player, kind, dir.x, dir.y, dir.z);
      return;
    }
  }
}

function tryDefuse(dt) {
  if (!state.planted || !player.alive) return;
  const s = world.sites[state.plantSite];
  const inZone = Math.abs(player.x - s.cx) < s.w / 2 && Math.abs(player.z - s.cz) < s.d / 2;
  const enemiesNear = state.actors.some((a) => a.alive && a.team === 'JK' && Math.hypot(a.x - player.x, a.z - player.z) < 12);
  if (inZone && input.keys.has('use') && !enemiesNear) {
    player.defuseT = (player.defuseT ?? 0) + dt;
    if (player.defuseT >= 4) {
      state.planted = false;
      state.pendingWin = { team: 'VG', reason: 'Spark defused' };
      player.defuseT = 0;
      audio.defuseDone();
    }
  } else {
    player.defuseT = 0;
  }
}

function tryRailgunPickup() {
  if (state.phase !== PHASE.LIVE || state.railgunTaken) return;
  const spot = state.railgunDropped ?? (state.powerRound ? { x: 0, z: 0 } : null);
  if (!spot) return;
  const d = Math.hypot(player.x - spot.x, player.z - spot.z);
  if (d < 2.2) {
    state.railgunTaken = true;
    state.railgunHolder = player.id;
    state.railgunDropped = null;
    player.weapons.railgun = true;
    player.ammo.railgun = { mag: 5, reserve: 0 };
    player.weapon = 'railgun';
    player.spreadHeat = 0;
    audio.power();
  }
}

// --- One fixed simulation step.
function simStep(dt) {
  state.tick++;
  state.time += dt;
  const pressed = input.consumePressed();

  if (pressed.has('mute')) {
    audio.setMuted(!audio.muted);
    state.muted = audio.muted;
  }
  if (pressed.has('buy') && state.phase === PHASE.BUY && player.alive) {
    hud.buyMenu.hidden = !hud.buyMenu.hidden;
    if (!hud.buyMenu.hidden) hud.buildBuyMenu(player);
  }
  if (!hud.buyMenu.hidden) {
    // Number keys buy while the menu is open.
    for (let i = 1; i <= 7; i++) {
      if (pressed.has(`slot${i}`)) {
        const item = [null, 'rifle', 'smg', 'marksman', 'armor', 'frag', 'smoke', 'flash'][i];
        if (item) buyItem(state, player, item, audio);
      }
    }
    if (pressed.has('escape')) hud.buyMenu.hidden = true;
  } else if (player.alive) {
    for (let i = 1; i <= 5; i++) {
      if (pressed.has(`slot${i}`)) switchWeapon(i);
    }
    if (input.wheel !== 0) {
      const order = ['pistol', 'smg', 'rifle', 'marksman', 'railgun'].filter((id) => player.weapons[id]);
      const cur = order.indexOf(player.weapon);
      const next = order[(cur + (input.wheel > 0 ? 1 : order.length - 1)) % order.length];
      if (next) switchWeapon(['pistol', 'smg', 'rifle', 'marksman', 'railgun'].indexOf(next) + 1);
      input.wheel = 0;
    }
    if (pressed.has('reload')) startReload();
    if (pressed.has('grenade') && state.phase === PHASE.LIVE) throwSelectedGrenade();
  }

  // Player movement and trigger.
  if (player.alive) {
    const speed = stepPlayer(player, input, dt, world.colliders);
    walkPhase += speed * dt * 2.2;
    if (speed > 0.5 && player.onGround) {
      player._stepT = (player._stepT ?? 0) + dt;
      if (player._stepT > 0.38) {
        player._stepT = 0;
        audio.step();
      }
    }
    if (player.fireT > 0) player.fireT -= dt;
    if (player.reloadT > 0) {
      player.reloadT -= dt;
      if (player.reloadT <= 0) {
        const w = WEAPONS[player.weapon];
        const ammo = player.ammo[player.weapon];
        const need = w.mag - ammo.mag;
        const take = Math.min(need, ammo.reserve);
        ammo.mag += take;
        ammo.reserve -= take;
      }
    }
    const weapon = WEAPONS[player.weapon];
    const semi = !weapon.auto;
    const triggerEdge = input.firing && !prevFiring;
    if (input.firing && state.phase === PHASE.LIVE && (!semi || triggerEdge)) tryFire();
    prevFiring = input.firing;
    player.spreadHeat = Math.max(0, player.spreadHeat - dt * 2.4);
    recoil = Math.max(0, recoil - dt * 0.06);
    tryDefuse(dt);
    tryRailgunPickup();
  }

  // Bots think only while the round is live; during buy phase they hold
  // at spawn. Reloads are counted down here, in one place.
  const rng = Math.random;
  for (const a of state.actors) {
    if (a.isPlayer || !a.alive) continue;
    if (state.phase === PHASE.LIVE) {
      stepBot(a, dt, { state, combat, waypoints: world.waypoints, colliders: world.colliders, rng, audio });
    }
    if (a.reloadT > 0) {
      a.reloadT -= dt;
      if (a.reloadT <= 0) {
        const w = WEAPONS[a.weapon];
        const ammo = a.ammo[a.weapon];
        if (ammo) {
          const need = w.mag - ammo.mag;
          const take = Math.min(need, ammo.reserve);
          ammo.mag += take;
          ammo.reserve -= take;
        }
      }
    }
  }

  combat.step(dt);
  stepRound(state, dt, world, audio);
  world.update(dt, state.time, state.powerRound, !state.railgunTaken && state.powerRound && !state.railgunDropped);

  // Phase-change banners.
  if (state.phase !== lastPhase) {
    if (state.phase === PHASE.END) {
      const won = state.winner === 'VG';
      hud.showBanner(
        won ? 'ROUND WON' : 'ROUND LOST',
        `${state.winReason} — Vanguard ${state.score.VG} : ${state.score.JK} Jackals`,
        won ? 'win' : 'lose',
      );
      bannerT = 5;
    } else if (state.phase === PHASE.BUY && state.powerRound) {
      hud.showBanner('POWER ROUND', 'The ARC-9 Longshot spawns on the mid plaza — race for it.', 'power');
      bannerT = 4;
    } else if (state.phase === PHASE.MATCH) {
      const won = state.matchWinner === 'VG';
      hud.showBanner(
        won ? 'MATCH WON' : 'MATCH LOST',
        `Vanguard ${state.score.VG} : ${state.score.JK} Jackals — click to play again.`,
        won ? 'win' : 'lose',
      );
      bannerT = 0;
      hud.overlay.hidden = false;
      document.getElementById('overlay-copy').textContent = won
        ? 'The market is yours. The Jackals are falling back to the east gate.'
        : 'The Jackals took the market. Regroup and run it back.';
      playButton.textContent = 'Play again';
    }
    lastPhase = state.phase;
  }
  if (bannerT > 0) {
    bannerT -= dt;
    if (bannerT <= 0 && state.phase !== PHASE.MATCH) hud.hideBanner();
  }
  if (state.phase === PHASE.MATCH && document.pointerLockElement) document.exitPointerLock();

  for (const a of state.actors) syncMesh(a);
}

// --- Camera: first person, or spectating a teammate when dead.
function updateCamera(dt) {
  const targetFov = player.weapon === 'marksman' && input.aiming && player.alive ? 32 : 75;
  camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 10);
  camera.updateProjectionMatrix();
  let ex;
  let ey;
  let ez;
  let yaw;
  let pitch;
  if (player.alive) {
    eyePos(player, _eye);
    ex = _eye.x;
    ey = _eye.y;
    ez = _eye.z;
    yaw = player.yaw;
    pitch = player.pitch + recoil;
  } else {
    const spec = state.actors.find((a) => a.id === state.spectate);
    if (spec) {
      eyePos(spec, _eye);
      ex = _eye.x;
      ey = _eye.y;
      ez = _eye.z;
      yaw = spec.yaw;
      pitch = 0;
    } else {
      ex = -28;
      ey = 2.2;
      ez = 0;
      yaw = -Math.PI / 2;
      pitch = -0.05;
    }
  }
  // A touch of shake while a grenade rings the player's ears.
  const shake = hud.update(player, dt);
  const shx = shake ? (Math.random() - 0.5) * 0.05 : 0;
  const shy = shake ? (Math.random() - 0.5) * 0.05 : 0;
  camera.position.set(ex + shx, ey + shy, ez);
  camera.rotation.set(pitch, yaw, 0);
  // Viewmodel bob and aim pose.
  const bob = player.alive ? Math.sin(walkPhase * 2) * 0.008 : 0;
  const aiming = input.aiming && player.alive;
  viewGun.position.x += ((aiming ? 0 : 0.32) - viewGun.position.x) * Math.min(1, dt * 12);
  viewGun.position.y = -0.3 + bob + (aiming ? 0.06 : 0);
  if (flashQuadT > 0) {
    flashQuadT -= dt;
    flashQuad.material.opacity = 0.95;
    flashQuad.rotation.z = Math.random() * Math.PI;
  } else {
    flashQuad.material.opacity = 0;
  }
  viewGun.visible = player.alive;
}

// --- Staged screenshots: real game state, posed for the camera.
// ?shot=start — buy phase at the plaza edge, buy menu open.
// ?shot=play  — mid-round firefight, an enemy in the crosshair.
// ?shot=site  — the Spark planted at site A, smoke on the lane.
// ?shot=end   — round won, banner up, lantern plaza behind.
function stageShot(kind) {
  const rng = makeRng(shotSeed);
  started = true;
  hud.overlay.hidden = true;
  const bots = state.actors.filter((a) => !a.isPlayer);
  const vgBots = bots.filter((a) => a.team === 'VG');
  const jkBots = bots.filter((a) => a.team === 'JK');

  if (kind === 'start') {
    state.phase = PHASE.BUY;
    state.phaseT = 12;
    state.round = 1;
    player.x = -12;
    player.z = 2;
    player.yaw = -Math.PI / 2 + 0.12;
    player.money = 3200;
    hud.buildBuyMenu(player);
    hud.buyMenu.hidden = false;
    for (const b of vgBots) {
      b.x = -20 - rng() * 4;
      b.z = -6 + rng() * 12;
      b.yaw = -Math.PI / 2;
    }
    for (const b of jkBots) {
      b.x = 24 + rng() * 4;
      b.z = -6 + rng() * 12;
      b.yaw = Math.PI / 2;
    }
  } else if (kind === 'play') {
    state.phase = PHASE.LIVE;
    state.phaseT = 72;
    state.round = 2;
    state.score.VG = 1;
    state.score.JK = 0;
    player.money = 3200;
    player.health = 78;
    player.ammo.rifle = { mag: 24, reserve: 60 };
    player.x = -10;
    player.z = -5;
    // Let the bots walk for 8 seconds so the fight is mid-lane. The player
    // sits out while they move (bots ignore dead actors), then steps back
    // in, alive, and aims at the nearest visible Jackal.
    player.alive = false;
    for (let i = 0; i < 480; i++) {
      for (const b of bots) {
        if (b.alive) stepBot(b, DT, { state, combat, waypoints: world.waypoints, colliders: world.colliders, rng, audio });
      }
      state.time += DT;
    }
    player.alive = true;
    player.health = 78;
    // Put the nearest Jackal on open ground 12 m ahead of the player,
    // facing them, mid-fight (55 health) — the shot needs an enemy in it.
    let best = null;
    let bestD = Infinity;
    for (const b of jkBots) {
      if (!b.alive) continue;
      const d = Math.hypot(b.x - player.x, b.z - player.z);
      if (d < bestD) {
        bestD = d;
        best = b;
      }
    }
    if (best) {
      best.x = -2;
      best.z = -3;
      best.health = 55;
      best.yaw = Math.atan2(-(player.x - best.x), -(player.z - best.z));
      player.yaw = Math.atan2(-(best.x - player.x), -(best.z - player.z));
      player.pitch = 0.0;
    }
    state.events.unshift({ tick: state.tick, text: 'Mira ✕ Rook', cls: 'VG', hs: false });
    state.events.unshift({ tick: state.tick, text: 'You ✕ Vex (headshot)', cls: 'VG', hs: true });
  } else if (kind === 'site') {
    state.phase = PHASE.LIVE;
    state.phaseT = 47;
    state.round = 3;
    state.powerRound = true;
    state.planted = true;
    state.plantSite = 'A';
    state.detonateT = 22;
    player.x = -8;
    player.z = -11;
    player.yaw = Math.atan2(-(-16 - player.x), -(-15 - player.z));
    player.health = 64;
    player.money = 4700;
    player.ammo.rifle = { mag: 18, reserve: 48 };
    const carrier = jkBots[0];
    carrier.x = -16;
    carrier.z = -15;
    carrier.yaw = Math.PI;
    const guard = jkBots[1];
    guard.x = -12;
    guard.z = -18;
    guard.yaw = Math.PI / 2;
    vgBots[0].x = -20;
    vgBots[0].z = -9;
    vgBots[0].yaw = -Math.PI / 2;
    // A real smoke cloud on the lane into the site.
    combat.grenades.push({ x: -10, y: 1.6, z: -13, vx: 0, vy: 0, vz: 0, kind: 'smoke', fuse: 0.01, owner: player });
    for (let i = 0; i < 90; i++) combat.step(DT);
  } else if (kind === 'end') {
    state.phase = PHASE.END;
    state.phaseT = 4;
    state.round = 3;
    state.score.VG = 2;
    state.score.JK = 1;
    state.winner = 'VG';
    state.winReason = 'Spark defused';
    player.x = -14;
    player.z = -8;
    player.yaw = Math.atan2(-(-16 - player.x), -(-15 - player.z));
    player.money = 6100;
    hud.showBanner('ROUND WON', 'Spark defused — Vanguard 2 : 1 Jackals', 'win');
    for (const b of vgBots) {
      b.x = -18 - rng() * 4;
      b.z = -12 + rng() * 6;
      b.yaw = -Math.PI / 2 + 0.3;
    }
    for (const b of jkBots) {
      b.alive = false;
      b.x = -16 + rng() * 4;
      b.z = -15 + rng() * 4;
    }
  }
  for (const a of state.actors) syncMesh(a);
  updateCamera(0);
  renderer.render(scene, camera);
  window.__shotReady = true;
  diag.textContent = `SHOT ${kind} READY tick=${state.tick}`;
}

// --- Main loop: fixed-step simulation, render every frame.
let last = performance.now();
let acc = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  // Staged shots freeze the sim (poses are the deliverable); autoplay runs
  // it unlocked so bots can play full rounds headlessly; normal play
  // pauses when the pointer lock is lost (alt-tab) outside the match end.
  const paused = shotMode || (!autoplay && started && !input.locked && state.phase !== PHASE.MATCH);
  if (started && !paused) {
    acc += dt;
    let n = 0;
    while (acc >= DT && n < 5) {
      simStep(DT);
      acc -= DT;
      n++;
    }
    if (n === 5) acc = 0;
  }
  updateCamera(dt);
  renderer.render(scene, camera);
  if (!window.__diagTick || state.tick - window.__diagTick > 60) {
    window.__diagTick = state.tick;
    diag.textContent = `tick=${state.tick} phase=${state.phase} round=${state.round} vg=${state.score.VG} jk=${state.score.JK}`;
  }
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

if (shotMode) {
  stageShot(shotMode);
}
requestAnimationFrame(frame);
