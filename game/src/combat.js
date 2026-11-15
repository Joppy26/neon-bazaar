// Neon Bazaar — combat. Hitscan guns, damage with headshots and armour,
// pooled tracers and muzzle flashes (no per-frame allocation), and the
// three grenades. Line of sight runs through the map colliders and the
// smoke clouds, so a smoke thrown across mid really does blind a lane.

import * as THREE from 'three';
import { rayBox, raySphere, clamp } from './util.js';
import { hitSpheres, eyePos } from './actors.js';
import { WEAPONS, GRENADES } from './weapons.js';
import { ECON } from './state.js';

const TRACER_COUNT = 20;
const _spheres = [
  { x: 0, y: 0, z: 0, r: 0, part: '' },
  { x: 0, y: 0, z: 0, r: 0, part: '' },
  { x: 0, y: 0, z: 0, r: 0, part: '' },
];
const _eye = { x: 0, y: 0, z: 0 };

export function createCombat(scene, state, audio, hooks) {
  const combat = {
    colliders: [],
    smokes: [], // {x, y, z, r, until, mesh}
    grenades: [], // {x, y, z, vx, vy, vz, kind, fuse, owner}
    _tracerI: 0,
    _tracers: [],
    _muzzleLight: null,
    _muzzleSprite: null,
    _boomLight: null,
  };

  // Pooled tracers: twenty lines, reused in order, never created mid-game.
  const tracerGeo = new THREE.BufferGeometry();
  tracerGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  for (let i = 0; i < TRACER_COUNT; i++) {
    const line = new THREE.Line(
      tracerGeo.clone(),
      new THREE.LineBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0 }),
    );
    line.frustumCulled = false;
    scene.add(line);
    combat._tracers.push({ line, life: 0 });
  }
  combat._muzzleLight = new THREE.PointLight(0xffc46b, 0, 9, 1.8);
  scene.add(combat._muzzleLight);
  combat._boomLight = new THREE.PointLight(0xff7a2e, 0, 22, 1.6);
  scene.add(combat._boomLight);

  combat.setColliders = (colliders) => {
    combat.colliders = colliders;
  };

  /** Line of sight between two points: walls, stalls and smoke all block it. */
  combat.losBlocked = (ax, ay, az, bx, by, bz) => {
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-6) return false;
    const ix = dx / len;
    const iy = dy / len;
    const iz = dz / len;
    for (const b of combat.colliders) {
      const t = rayBox(ax, ay, az, ix, iy, iz, b);
      if (t >= 0 && t < len) return true;
    }
    for (const s of combat.smokes) {
      const t = raySphere(ax, ay, az, ix, iy, iz, s.x, s.y, s.z, s.r);
      if (t >= 0 && t < len) return true;
    }
    return false;
  };

  function spawnTracer(from, to, color) {
    const t = combat._tracers[combat._tracerI];
    combat._tracerI = (combat._tracerI + 1) % TRACER_COUNT;
    const pos = t.line.geometry.attributes.position.array;
    pos[0] = from.x;
    pos[1] = from.y;
    pos[2] = from.z;
    pos[3] = to.x;
    pos[4] = to.y;
    pos[5] = to.z;
    t.line.geometry.attributes.position.needsUpdate = true;
    t.line.material.color.setHex(color);
    t.line.material.opacity = 0.9;
    t.life = 0.07;
  }

  function muzzleAt(p, dir) {
    const l = combat._muzzleLight;
    l.position.set(p.x + dir.x * 0.4, p.y + dir.y * 0.4, p.z + dir.z * 0.4);
    l.intensity = 26;
  }

  /**
   * One hitscan shot. `dir` is a unit vector. Returns the hit actor, if any.
   * The railgun pierces: it keeps going through every actor on the line.
   */
  combat.fire = (shooter, weapon, ox, oy, oz, dx, dy, dz, rng, spreadDeg) => {
    // Spread: a small random cone around the aim direction.
    const spreadRad = (spreadDeg * Math.PI) / 180;
    const rx = (rng() - 0.5) * 2 * spreadRad;
    const ry = (rng() - 0.5) * 2 * spreadRad;
    // Build an orthonormal basis around the direction and perturb it.
    const ux = -dz;
    const uz = dx;
    const ul = Math.hypot(ux, uz) || 1;
    const vx = -dy * dx;
    const vy = 1 - dy * dy;
    const vz = -dy * dz;
    const vl = Math.hypot(vx, vy, vz) || 1;
    const fdx = dx + (ux / ul) * rx + (vx / vl) * ry;
    const fdy = dy + (vy / vl) * ry;
    const fdz = dz + (uz / ul) * rx + (vz / vl) * ry;
    const fl = Math.hypot(fdx, fdy, fdz);
    const nx = fdx / fl;
    const ny = fdy / fl;
    const nz = fdz / fl;

    // Nearest wall along the ray caps the shot.
    let wallT = weapon.range;
    for (const b of combat.colliders) {
      const t = rayBox(ox, oy, oz, nx, ny, nz, b);
      if (t >= 0 && t < wallT) wallT = t;
    }
    for (const s of combat.smokes) {
      const t = raySphere(ox, oy, oz, nx, ny, nz, s.x, s.y, s.z, s.r);
      if (t >= 0 && t < wallT) wallT = t;
    }

    // Nearest (or every, for the railgun) actor sphere along the ray.
    const hits = [];
    for (const target of state.actors) {
      if (!target.alive || target === shooter || target.team === shooter.team) continue;
      hitSpheres(target, _spheres);
      for (const s of _spheres) {
        const t = raySphere(ox, oy, oz, nx, ny, nz, s.x, s.y, s.z, s.r);
        if (t >= 0 && t < wallT) hits.push({ target, part: s.part, t });
      }
    }
    hits.sort((a, b) => a.t - b.t);
    const end = { x: ox + nx * wallT, y: oy + ny * wallT, z: oz + nz * wallT };
    const muzzle = { x: ox, y: oy, z: oz };
    muzzleAt(muzzle, { x: nx, y: ny, z: nz });
    const tracerColor = weapon.id === 'railgun' ? 0x7df9ff : 0xffe9a8;

    let firstHit = null;
    if (hits.length > 0) {
      if (weapon.pierce) {
        const seen = new Set();
        for (const h of hits) {
          if (seen.has(h.target.id)) continue;
          seen.add(h.target.id);
          combat.damage(h.target, weapon, h.part, h.t, shooter);
          firstHit = firstHit ?? h.target;
        }
        spawnTracer(muzzle, end, tracerColor);
      } else {
        const h = hits[0];
        combat.damage(h.target, weapon, h.part, h.t, shooter);
        end.x = ox + nx * h.t;
        end.y = oy + ny * h.t;
        end.z = oz + nz * h.t;
        spawnTracer(muzzle, end, tracerColor);
        firstHit = h.target;
      }
    } else {
      spawnTracer(muzzle, end, tracerColor);
    }
    audio.shot(weapon.kind);
    return firstHit;
  };

  /** Damage with falloff, headshots and armour. Handles death and drops. */
  combat.damage = (target, weapon, part, dist, attacker) => {
    // Staged screenshot runs: the posed player never takes damage, so the
    // framed health value stays exactly as staged.
    if (state.shotMode && target.isPlayer) return;
    const isHead = part === 'head';
    let dmg = weapon.damage * (isHead ? weapon.headMult : 1);
    if (dist > 25) dmg *= Math.max(0.7, 1 - (dist - 25) * 0.01);
    if (target.armor > 0) {
      const absorbed = Math.min(target.armor, dmg * 0.5);
      target.armor -= absorbed;
      dmg -= absorbed;
    }
    target.health -= dmg;
    if (attacker) {
      if (attacker.isPlayer) hooks.onHit(isHead, false);
      if (target.isPlayer) hooks.onHurt();
    }
    if (target.health <= 0 && target.alive) {
      combat.kill(target, attacker, isHead);
    }
  };

  combat.kill = (target, attacker, headshot) => {
    target.alive = false;
    target.health = 0;
    target.deaths++;
    if (attacker && attacker !== target) {
      attacker.kills++;
      attacker.money += ECON.kill;
    }
    const killerName = attacker ? attacker.name : '—';
    state.events.unshift({
      tick: state.tick,
      text: `${killerName} ✕ ${target.name}${headshot ? ' (headshot)' : ''}`,
      cls: attacker ? attacker.team : '',
      hs: headshot,
    });
    if (state.events.length > 6) state.events.length = 6;
    if (attacker && attacker.isPlayer) hooks.onHit(headshot, true);
    // The Spark drops where its carrier fell; the railgun too.
    if (state.carrier === target.id) {
      state.carrier = null;
      state.sparkDropped = { x: target.x, z: target.z };
    }
    if (state.railgunHolder === target.id) {
      state.railgunHolder = null;
      state.railgunTaken = false;
      state.railgunDropped = { x: target.x, z: target.z };
    }
    if (target.isPlayer) hooks.onDeath();
  };

  /** Throw a grenade from an actor, in the direction they face. */
  combat.throwGrenade = (actor, kind, dx, dy, dz) => {
    if (actor.grenades[kind] <= 0) return false;
    actor.grenades[kind]--;
    eyePos(actor, _eye);
    combat.grenades.push({
      x: _eye.x + dx * 0.5,
      y: _eye.y,
      z: _eye.z + dz * 0.5,
      vx: dx * 13 + actor.vx * 0.4,
      vy: dy * 13 + 4.5,
      vz: dz * 13 + actor.vz * 0.4,
      kind,
      fuse: GRENADES[kind].fuse,
      owner: actor,
    });
    audio.grenadeThrow();
    return true;
  };

  function explodeFrag(g) {
    combat._boomLight.position.set(g.x, g.y + 1, g.z);
    combat._boomLight.intensity = 90;
    audio.explosion();
    if (g.owner && g.owner.isPlayer) hooks.onShake(0.5);
    for (const target of state.actors) {
      if (!target.alive) continue;
      const d = Math.hypot(target.x - g.x, target.y + 0.9 - g.y, target.z - g.z);
      if (d > GRENADES.frag.radius) continue;
      eyePos(target, _eye);
      if (combat.losBlocked(g.x, g.y, g.z, _eye.x, _eye.y, _eye.z)) continue;
      const dmg = Math.round(GRENADES.frag.damage * (1 - (d / GRENADES.frag.radius) * 0.6));
      if (state.shotMode && target.isPlayer) continue;
      target.health -= dmg;
      if (target.isPlayer) hooks.onHurt();
      if (target.health <= 0 && target.alive) combat.kill(target, g.owner, false);
    }
  }

  function deploySmoke(g) {
    const geo = new THREE.SphereGeometry(GRENADES.smoke.radius, 12, 10);
    const mat = new THREE.MeshLambertMaterial({ color: 0x9aa3b5, transparent: true, opacity: 0.55 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(g.x, Math.max(1.6, g.y), g.z);
    scene.add(mesh);
    combat.smokes.push({
      x: g.x,
      y: Math.max(1.6, g.y),
      z: g.z,
      r: GRENADES.smoke.radius,
      until: state.time + GRENADES.smoke.duration,
      mesh,
    });
  }

  function detonateFlash(g) {
    const range = GRENADES.flash.radius;
    for (const target of state.actors) {
      if (!target.alive) continue;
      const d = Math.hypot(target.x - g.x, target.y + 1.2 - g.y, target.z - g.z);
      if (d > range) continue;
      eyePos(target, _eye);
      // Facing the flash matters: a dot product with the view direction.
      const fx = _eye.x - g.x;
      const fy = _eye.y - g.y;
      const fz = _eye.z - g.z;
      const fl = Math.hypot(fx, fy, fz) || 1;
      const lookX = -Math.sin(target.yaw);
      const lookZ = -Math.cos(target.yaw);
      const facing = (fx / fl) * lookX + (fz / fl) * lookZ;
      if (facing < -0.2) continue; // looking away
      if (combat.losBlocked(g.x, g.y, g.z, _eye.x, _eye.y, _eye.z)) continue;
      const strength = clamp(1 - d / range, 0.35, 1);
      if (target.isPlayer) hooks.onFlash(strength * GRENADES.flash.blind);
      else if (target.bot) target.bot.blindT = strength * GRENADES.flash.blind;
    }
    combat._boomLight.position.set(g.x, g.y + 1, g.z);
    combat._boomLight.intensity = 60;
  }

  /** Per-frame: tracers fade, grenades fly and blow, smoke clears. */
  combat.step = (dt) => {
    for (const t of combat._tracers) {
      if (t.life > 0) {
        t.life -= dt;
        t.line.material.opacity = Math.max(0, t.life / 0.07) * 0.9;
      }
    }
    combat._muzzleLight.intensity = Math.max(0, combat._muzzleLight.intensity - dt * 320);
    combat._boomLight.intensity = Math.max(0, combat._boomLight.intensity - dt * 260);
    for (let i = combat.grenades.length - 1; i >= 0; i--) {
      const g = combat.grenades[i];
      g.vy -= 13.5 * dt;
      g.x += g.vx * dt;
      g.y += g.vy * dt;
      g.z += g.vz * dt;
      if (g.y < 0.25) {
        g.y = 0.25;
        g.vy = Math.abs(g.vy) * 0.35;
        g.vx *= 0.7;
        g.vz *= 0.7;
      }
      g.x = clamp(g.x, -31.5, 31.5);
      g.z = clamp(g.z, -23.5, 23.5);
      g.fuse -= dt;
      if (g.fuse <= 0) {
        if (g.kind === 'frag') explodeFrag(g);
        else if (g.kind === 'smoke') deploySmoke(g);
        else if (g.kind === 'flash') detonateFlash(g);
        combat.grenades.splice(i, 1);
      }
    }
    for (let i = combat.smokes.length - 1; i >= 0; i--) {
      const s = combat.smokes[i];
      if (state.time > s.until) {
        scene.remove(s.mesh);
        s.mesh.geometry.dispose();
        s.mesh.material.dispose();
        combat.smokes.splice(i, 1);
      }
    }
  };

  return combat;
}
