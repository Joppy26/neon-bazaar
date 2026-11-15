// Neon Bazaar — actors. An actor is one combatant: the player or a bot.
// The mesh is built from boxes (a hooded market-runner silhouette with a
// glowing team visor), and the hit test uses three spheres — head, torso,
// legs — so headshots pay and crouching changes what can be hit. All
// movement goes through moveActor, which slides along the map's colliders.

import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { clamp } from './util.js';
export const ACTOR = {
  radius: 0.42,
  height: 1.75,
  crouchHeight: 1.25,
  eyeStand: 1.62,
  eyeCrouch: 1.12,
  walkSpeed: 4.3,
  crouchSpeed: 2.1,
  quietSpeed: 2.3,
  accel: 42,
  jumpVel: 5.4,
  gravity: 13.5,
};

let nextId = 1;

/** Build one actor: state plus its three.js group. `isPlayer` skips the mesh. */
export function createActor(team, name, isPlayer, weaponId) {
  const color = team === 'VG' ? PALETTE.vanguard : PALETTE.jackal;
  const actor = {
    id: nextId++,
    team,
    name,
    isPlayer,
    alive: true,
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    yaw: 0,
    pitch: 0,
    crouched: false,
    onGround: true,
    health: 100,
    armor: 0,
    money: 800,
    weapon: weaponId,
    weapons: { [weaponId]: true },
    ammo: {},
    grenades: { frag: 0, smoke: 0, flash: 0 },
    kills: 0,
    deaths: 0,
    // Bot brain (unused by the player): current goal and route.
    bot: isPlayer ? null : { state: 'idle', route: null, routeI: 0, target: null, aimT: 0, burstLeft: 0, burstT: 0, holdT: 0, site: null, investigate: null, plantT: 0, defuseT: 0 },
    // Per-frame scratch, reused so the hot loops allocate nothing.
    _tmp: { x: 0, z: 0 },
    mesh: null,
    visor: null,
    gunMesh: null,
    flashT: 0,
  };
  if (!isPlayer) {
    const group = new THREE.Group();
    const bodyMat = new THREE.MeshLambertMaterial({ color: team === 'VG' ? 0x1e5a58 : 0x6e2f1e });
    const darkMat = new THREE.MeshLambertMaterial({ color: 0x14161f });
    const glowMat = new THREE.MeshBasicMaterial({ color });
    // Legs, torso, head, shoulders: a hooded runner, readable at a glance.
    const legL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.8, 0.2), darkMat);
    legL.position.set(-0.11, 0.4, 0);
    const legR = legL.clone();
    legR.position.x = 0.11;
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.62, 0.3), bodyMat);
    torso.position.y = 1.11;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), darkMat);
    head.position.y = 1.58;
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.07, 0.05), glowMat);
    visor.position.set(0, 1.6, 0.16);
    const shoulderL = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.3), bodyMat);
    shoulderL.position.set(-0.32, 1.36, 0);
    const shoulderR = shoulderL.clone();
    shoulderR.position.x = 0.32;
    // The gun: a dark box held forward, tipped with the team colour.
    const gun = new THREE.Group();
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.62), darkMat);
    barrel.position.set(0, 0, 0.2);
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.05, 0.08), glowMat);
    tip.position.set(0, 0.02, 0.52);
    gun.add(barrel, tip);
    gun.position.set(0.22, 1.18, 0.25);
    group.add(legL, legR, torso, head, visor, shoulderL, shoulderR, gun);
    actor.mesh = group;
    actor.visor = visor;
    actor.gunMesh = gun;
    actor._legs = [legL, legR];
  }
  return actor;
}

/** The three hit spheres of an actor, in world space. Head first. */
export function hitSpheres(actor, out) {
  const crouch = actor.crouched ? 0.45 : 0;
  out[0].x = actor.x;
  out[0].y = actor.y + 1.52 - crouch;
  out[0].z = actor.z;
  out[0].r = 0.21;
  out[0].part = 'head';
  out[1].x = actor.x;
  out[1].y = actor.y + 1.05 - crouch;
  out[1].z = actor.z;
  out[1].r = 0.38;
  out[1].part = 'body';
  out[2].x = actor.x;
  out[2].y = actor.y + 0.5 - crouch * 0.5;
  out[2].z = actor.z;
  out[2].r = 0.32;
  out[2].part = 'legs';
  return out;
}

/** Eye position (for line of sight and shooting). */
export function eyePos(actor, out) {
  out.x = actor.x;
  out.y = actor.y + (actor.crouched ? ACTOR.eyeCrouch : ACTOR.eyeStand);
  out.z = actor.z;
  return out;
}

/**
 * Move an actor by (dx, dz) with collision: each axis resolves separately
 * so the actor slides along walls instead of sticking to them.
 */
export function moveActor(actor, dx, dz, colliders) {
  const r = ACTOR.radius;
  const tmp = actor._tmp;
  // X axis.
  let nx = actor.x + dx;
  for (let i = 0; i < colliders.length; i++) {
    const b = colliders[i];
    if (actor.z + r <= b.minZ || actor.z - r >= b.maxZ) continue;
    if (nx + r > b.minX && nx - r < b.maxX) {
      nx = dx > 0 ? b.minX - r : b.maxX + r;
    }
  }
  actor.x = nx;
  // Z axis.
  let nz = actor.z + dz;
  for (let i = 0; i < colliders.length; i++) {
    const b = colliders[i];
    if (actor.x + r <= b.minX || actor.x - r >= b.maxX) continue;
    if (nz + r > b.minZ && nz - r < b.maxZ) {
      nz = dz > 0 ? b.minZ - r : b.maxZ + r;
    }
  }
  actor.z = nz;
  // Keep inside the map bounds (the walls already do this, but be safe).
  actor.x = clamp(actor.x, -31.4, 31.4);
  actor.z = clamp(actor.z, -23.4, 23.4);
}

/** Keep a dead actor's mesh lying down, or an alive one's mesh upright. */
export function syncMesh(actor) {
  if (!actor.mesh) return;
  const m = actor.mesh;
  m.position.set(actor.x, actor.y, actor.z);
  if (!actor.alive) {
    m.rotation.set(-Math.PI / 2, 0, actor.yaw);
    m.position.y = 0.25;
    return;
  }
  m.rotation.set(0, actor.yaw, 0);
  // A little run-cycle on the legs, purely cosmetic.
  const speed = Math.hypot(actor.vx, actor.vz);
  const swing = speed > 0.5 ? Math.sin(actor._walkPhase ?? 0) * 0.45 : 0;
  actor._walkPhase = (actor._walkPhase ?? 0) + speed * 0.09;
  if (actor._legs) {
    actor._legs[0].rotation.x = swing;
    actor._legs[1].rotation.x = -swing;
  }
  // Crouch: squash the whole figure.
  const s = actor.crouched ? 0.72 : 1;
  m.scale.set(1, s, 1);
}
