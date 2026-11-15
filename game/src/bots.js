// Neon Bazaar — bot AI. One brain per bot, four jobs: attackers push a
// site and plant the Spark, defenders hold angles and retake, everyone
// fights what they see and investigates what they hear, and on a power
// round the nearest bot on each team races the mid plaza for the Longshot.
// Bots see through line of sight (walls and smoke block it), hear gunfire,
// and shoot in bursts with an aim time — they are fair opponents, not
// aimbots: accuracy falls with range and with a moving target.

import { nearestNode, findRoute, shortcutRoute } from './nav.js';
import { moveActor, eyePos, ACTOR } from './actors.js';
import { WEAPONS } from './weapons.js';
import { currentSpread } from './player.js';
import { clamp } from './util.js';

const _eye = { x: 0, y: 0, z: 0 };
const _targetEye = { x: 0, y: 0, z: 0 };
const _dir = { x: 0, y: 0, z: 0 };

/** Pick a site for the attacking team this round (2 bots A, 2 bots B). */
export function assignSites(state, rng) {
  const attackers = state.actors.filter((a) => a.team === 'JK' && a.alive);
  attackers.forEach((a, i) => {
    a.bot.site = i % 2 === 0 ? 'A' : 'B';
  });
  // The carrier is the first attacker; they hold the Spark from round start.
  if (attackers.length > 0) {
    state.carrier = attackers[0].id;
    attackers[0].bot.site = rng() < 0.5 ? 'A' : 'B';
  }
}

/** The nearest living enemy the bot can actually see, or null. */
function visibleEnemy(combat, bot, state) {
  eyePos(bot, _eye);
  let best = null;
  let bestD = Infinity;
  for (const other of state.actors) {
    if (!other.alive || other.team === bot.team) continue;
    eyePos(other, _targetEye);
    const dx = _targetEye.x - _eye.x;
    const dy = _targetEye.y - _eye.y;
    const dz = _targetEye.z - _eye.z;
    const d = Math.hypot(dx, dy, dz);
    if (d > 42) continue;
    if (combat.losBlocked(_eye.x, _eye.y, _eye.z, _targetEye.x, _targetEye.y, _targetEye.z)) continue;
    // Field of view: bots notice movement in front of them first.
    const fx = -Math.sin(bot.yaw);
    const fz = -Math.cos(bot.yaw);
    const facing = (dx / d) * fx + (dz / d) * fz;
    if (facing < -0.15 && d > 6) continue;
    if (d < bestD) {
      bestD = d;
      best = other;
    }
  }
  return best ? { enemy: best, dist: bestD } : null;
}

/** Turn the bot toward a point, at a limited turn rate. */
function turnToward(bot, x, z, dt, rate = 7) {
  const want = Math.atan2(-(x - bot.x), -(z - bot.z));
  let diff = want - bot.yaw;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  const step = clamp(diff, -rate * dt, rate * dt);
  bot.yaw += step;
  return Math.abs(diff) < 0.08;
}

/** Walk along the bot's route. Returns true when the route is finished. */
function followRoute(bot, dt, colliders, waypoints, state) {
  const route = bot.bot.route;
  if (!route || bot.bot.routeI >= route.length) return true;
  const p = route[bot.bot.routeI];
  const dx = p.x - bot.x;
  const dz = p.z - bot.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.7) {
    bot.bot.routeI++;
    return bot.bot.routeI >= route.length;
  }
  turnToward(bot, p.x, p.z, dt, 9);
  const speed = bot.crouched ? ACTOR.crouchSpeed : ACTOR.walkSpeed * 0.92;
  const vx = (dx / d) * speed;
  const vz = (dz / d) * speed;
  bot.vx = vx;
  bot.vz = vz;
  moveActor(bot, vx * dt, vz * dt, colliders);
  return false;
}

function setRoute(bot, waypoints, colliders, targetNode) {
  const route = findRoute(waypoints, bot.x, bot.z, targetNode);
  bot.bot.route = route ? shortcutRoute(route, bot.x, bot.z, colliders) : null;
  bot.bot.routeI = 0;
}

function nearestNodeId(waypoints, x, z) {
  return nearestNode(waypoints, x, z);
}

/**
 * One fixed step of bot AI. `ctx` carries the world, the combat system,
 * the audio and a seeded rng. Bots think every step but only re-plan
 * routes when their goal changes, so the cost stays flat.
 */
export function stepBot(bot, dt, ctx) {
  const { state, combat, waypoints, colliders, rng, audio } = ctx;
  const brain = bot.bot;
  if (!bot.alive) return;
  if (brain.blindT > 0) {
    brain.blindT -= dt;
    bot.vx = 0;
    bot.vz = 0;
    return; // flashed: frozen, blinking in the smoke and light
  }

  const weapon = WEAPONS[bot.weapon];
  const seen = visibleEnemy(combat, bot, state);

  // A dropped railgun on the floor is worth picking up for anyone nearby.
  if (state.railgunDropped) {
    const d = Math.hypot(bot.x - state.railgunDropped.x, bot.z - state.railgunDropped.z);
    if (d < 1.4) {
      state.railgunTaken = true;
      state.railgunHolder = bot.id;
      state.railgunDropped = null;
      bot.weapons.railgun = true;
      bot.ammo.railgun = { mag: 5, reserve: 0 };
      bot.weapon = 'railgun';
      bot.spreadHeat = 0;
      audio.power();
    }
  }

  // --- Combat: an enemy in sight beats any plan.
  if (seen) {
    const { enemy, dist } = seen;
    brain.target = enemy;
    eyePos(enemy, _targetEye);
    const facing = turnToward(bot, _targetEye.x, _targetEye.z, dt, 10);
    // Strafe sideways between bursts so the bot is not a still target.
    const strafeDir = Math.sin(state.time * 0.9 + bot.id * 2.4) > 0 ? 1 : -1;
    if (brain.burstLeft <= 0) {
      // Start a burst: aim first, longer at long range.
      if (brain.aimT <= 0) brain.aimT = 0.25 + dist * 0.008 + rng() * 0.2;
      brain.aimT -= dt;
      if (brain.aimT <= 0 && facing) {
        brain.burstLeft = 3 + Math.floor(rng() * 3);
        brain.burstT = 0;
      }
    }
    if (brain.burstLeft > 0) {
      brain.burstT -= dt;
      if (brain.burstT <= 0) {
        brain.burstT = weapon.interval * (1 + rng() * 0.4);
        brain.burstLeft--;
        const moving = Math.hypot(enemy.vx, enemy.vz) > 1;
        let spread = currentSpread(bot, weapon, false, false, 0);
        spread += dist * 0.045 + (moving ? 0.9 : 0);
        eyePos(bot, _eye);
        _dir.x = _targetEye.x - _eye.x;
        _dir.y = _targetEye.y - _eye.y;
        _dir.z = _targetEye.z - _eye.z;
        const dl = Math.hypot(_dir.x, _dir.y, _dir.z) || 1;
        _dir.x /= dl;
        _dir.y /= dl;
        _dir.z /= dl;
        const ammo = bot.ammo[bot.weapon];
        if (ammo && ammo.mag > 0 && bot.reloadT <= 0) {
          ammo.mag--;
          combat.fire(bot, weapon, _eye.x, _eye.y, _eye.z, _dir.x, _dir.y, _dir.z, rng, spread);
          bot.spreadHeat = Math.min(2, (bot.spreadHeat ?? 0) + weapon.heat * 0.4);
        } else if (ammo && ammo.mag <= 0 && bot.reloadT <= 0) {
          bot.reloadT = weapon.reload;
        }
        // Step sideways while firing.
        moveActor(bot, -Math.cos(bot.yaw) * strafeDir * 1.1 * dt, Math.sin(bot.yaw) * strafeDir * 1.1 * dt, colliders);
      }
    }
    // Hear the shot: every bot nearby learns where the fight is.
    if (brain.burstLeft > 0) {
      for (const other of state.actors) {
        if (!other.alive || other === bot || !other.bot) continue;
        const d = Math.hypot(other.x - bot.x, other.z - bot.z);
        if (d < 26) other.bot.investigate = { x: enemy.x, z: enemy.z, until: state.time + 6 };
      }
    }
    bot.spreadHeat = Math.max(0, (bot.spreadHeat ?? 0) - dt * 2.2);
    return;
  }
  brain.target = null;

  // --- Reload when the magazine is dry and nobody is in sight.
  const ammo = bot.ammo[bot.weapon];
  if (ammo && ammo.mag <= 0 && bot.reloadT <= 0) {
    bot.reloadT = WEAPONS[bot.weapon].reload;
  }
  if (bot.reloadT > 0) {
    // Reloading: stand still; the main loop counts the timer down.
    bot.vx = 0;
    bot.vz = 0;
    return;
  }

  // --- Power round: race the mid plaza for the Longshot.
  if (state.powerRound && !state.railgunTaken && brain.state !== 'power') {
    brain.state = 'power';
    setRoute(bot, waypoints, colliders, 'mid');
  }
  if (brain.state === 'power') {
    if (state.railgunTaken) {
      brain.state = 'idle';
    } else {
      const d = Math.hypot(bot.x, bot.z);
      if (d < 2.2) {
        state.railgunTaken = true;
        state.railgunHolder = bot.id;
        state.railgunDropped = null;
        bot.weapons.railgun = true;
        bot.ammo.railgun = { mag: 5, reserve: 0 };
        bot.weapon = 'railgun';
        bot.spreadHeat = 0;
        audio.power();
        brain.state = 'idle';
      } else if (followRoute(bot, dt, colliders, waypoints, state)) {
        // Route done but the pedestal is still ahead: walk straight at it.
        const nx = -bot.x / d;
        const nz = -bot.z / d;
        bot.vx = nx * ACTOR.walkSpeed * 0.92;
        bot.vz = nz * ACTOR.walkSpeed * 0.92;
        moveActor(bot, bot.vx * dt, bot.vz * dt, colliders);
        turnToward(bot, 0, 0, dt, 9);
      }
      return;
    }
  }

  // --- The Spark: the carrier plants, the others cover, defenders retake.
  const site = brain.site ?? 'A';
  if (bot.team === 'JK') {
    if (state.carrier === bot.id) {
      const s = state.sites[site];
      const inZone = Math.abs(bot.x - s.cx) < s.w / 2 && Math.abs(bot.z - s.cz) < s.d / 2;
      if (state.planted) {
        // Planted: guard the site from a hold spot.
        if (brain.state !== 'guard') {
          brain.state = 'guard';
          setRoute(bot, waypoints, colliders, site === 'A' ? 'aHold2' : 'bHold2');
        }
        followRoute(bot, dt, colliders, waypoints, state);
        return;
      }
      if (inZone) {
        // Planting: stand still in the zone for 3 seconds.
        brain.plantT = (brain.plantT ?? 0) + dt;
        bot.vx = 0;
        bot.vz = 0;
        if (brain.plantT >= 3) {
          state.planted = true;
          state.plantSite = site;
          state.detonateT = 35;
          brain.plantT = 0;
          audio.plantDone();
        }
        return;
      }
      brain.plantT = 0;
      if (brain.state !== 'plant') {
        brain.state = 'plant';
        setRoute(bot, waypoints, colliders, site === 'A' ? 'aSite' : 'bSite');
      }
      followRoute(bot, dt, colliders, waypoints, state);
      return;
    }
    // Non-carrier attacker: escort to the site, then hold an angle.
    if (state.planted) {
      if (brain.state !== 'guard') {
        brain.state = 'guard';
        setRoute(bot, waypoints, colliders, state.plantSite === 'A' ? 'aHold1' : 'bHold1');
      }
      followRoute(bot, dt, colliders, waypoints, state);
      return;
    }
    if (brain.state !== 'escort') {
      brain.state = 'escort';
      setRoute(bot, waypoints, colliders, site === 'A' ? 'aSite' : 'bSite');
    }
    followRoute(bot, dt, colliders, waypoints, state);
    // Pick up a dropped Spark by walking over it.
    if (state.sparkDropped) {
      const d = Math.hypot(bot.x - state.sparkDropped.x, bot.z - state.sparkDropped.z);
      if (d < 1.4) {
        state.carrier = bot.id;
        state.sparkDropped = null;
      }
    }
    return;
  }

  // --- Defenders.
  if (state.planted) {
    // Retake: get into the zone and defuse, 4 seconds standing still.
    const s = state.sites[state.plantSite];
    const inZone = Math.abs(bot.x - s.cx) < s.w / 2 && Math.abs(bot.z - s.cz) < s.d / 2;
    if (inZone) {
      const enemiesNear = state.actors.some((a) => a.alive && a.team === 'JK' && Math.hypot(a.x - bot.x, a.z - bot.z) < 12);
      if (!enemiesNear) {
        brain.defuseT = (brain.defuseT ?? 0) + dt;
        bot.vx = 0;
        bot.vz = 0;
        if (brain.defuseT >= 4) {
          state.planted = false;
          state.pendingWin = { team: 'VG', reason: 'Spark defused' };
          brain.defuseT = 0;
          audio.defuseDone();
        }
        return;
      }
    }
    brain.defuseT = 0;
    if (brain.state !== 'retake') {
      brain.state = 'retake';
      setRoute(bot, waypoints, colliders, state.plantSite === 'A' ? 'aSite' : 'bSite');
    }
    followRoute(bot, dt, colliders, waypoints, state);
    return;
  }
  // Hold: each defender owns an angle near their site or mid.
  if (brain.state !== 'hold') {
    brain.state = 'hold';
    const holds = bot.id % 3 === 0 ? ['aHold1', 'bHold1'] : bot.id % 3 === 1 ? ['aHold2', 'midNorth'] : ['bHold2', 'midSouth'];
    const node = holds[Math.floor(rng() * holds.length)];
    setRoute(bot, waypoints, colliders, node);
    brain.holdT = 4 + rng() * 6;
  }
  const arrived = followRoute(bot, dt, colliders, waypoints, state);
  if (arrived) {
    brain.holdT -= dt;
    // Scan the lane: slow sweeps, so the bot looks alive and can spot.
    bot.yaw += Math.sin(state.time * 0.7 + bot.id) * 0.35 * dt;
    if (brain.holdT <= 0) {
      brain.state = 'idle';
    }
  }
  // Investigate a noise: gunfire the bot heard but did not see.
  if (brain.investigate && state.time < brain.investigate.until) {
    const inv = brain.investigate;
    const d = Math.hypot(inv.x - bot.x, inv.z - bot.z);
    if (d > 2) {
      const node = nearestNodeId(waypoints, inv.x, inv.z);
      if (brain.state !== 'investigate') {
        brain.state = 'investigate';
        setRoute(bot, waypoints, colliders, node);
      }
      followRoute(bot, dt, colliders, waypoints, state);
    } else {
      brain.investigate = null;
      brain.state = 'idle';
    }
  }
}
