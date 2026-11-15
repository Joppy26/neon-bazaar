// Neon Bazaar — the player controller. Mouse look with pointer lock,
// WASD with acceleration, crouch, a quiet walk, a small jump, and the
// accuracy model: spread grows while moving or firing, shrinks while
// crouched, aiming or standing still. Stopping to aim pays — that is the
// whole gunplay idea, and the numbers here are what enforces it.

import { ACTOR, moveActor } from './actors.js';
import { clamp, lerp } from './util.js';

export const LOOK_SENS = 0.0023;

/** Spread in degrees for an actor holding `weapon`, right now. */
export function currentSpread(actor, weapon, aiming, moving, airTime) {
  let spread = weapon.spread;
  if (aiming) spread *= 0.45;
  if (actor.crouched) spread *= 0.7;
  if (moving) spread *= 1.9;
  if (airTime > 0) spread *= 2.6;
  // Firing heats the spread up; it cools back down when the trigger lifts.
  spread += actor.spreadHeat * weapon.heat;
  return spread;
}

/** One fixed step of player movement. Returns the horizontal speed. */
export function stepPlayer(actor, input, dt, colliders) {
  const look = input.consumeLook();
  actor.yaw -= look.dx * LOOK_SENS;
  actor.pitch = clamp(actor.pitch - look.dy * LOOK_SENS, -1.45, 1.45);

  const keys = input.keys;
  let ix = 0;
  let iz = 0;
  if (keys.has('forward')) iz -= 1;
  if (keys.has('back')) iz += 1;
  if (keys.has('left')) ix -= 1;
  if (keys.has('right')) ix += 1;
  const moving = ix !== 0 || iz !== 0;
  const len = Math.hypot(ix, iz) || 1;
  ix /= len;
  iz /= len;

  actor.crouched = keys.has('crouch');
  const quiet = keys.has('walk');
  const speed = actor.crouched ? ACTOR.crouchSpeed : quiet ? ACTOR.quietSpeed : ACTOR.walkSpeed;

  // Rotate the wish direction by the yaw (forward is -Z at yaw 0).
  const sin = Math.sin(actor.yaw);
  const cos = Math.cos(actor.yaw);
  const wx = ix * cos - iz * sin;
  const wz = ix * sin + iz * cos;

  const targetVx = wx * speed;
  const targetVz = wz * speed;
  const rate = actor.onGround ? ACTOR.accel * dt : ACTOR.accel * 0.4 * dt;
  actor.vx = lerp(actor.vx, targetVx, Math.min(1, rate));
  actor.vz = lerp(actor.vz, targetVz, Math.min(1, rate));

  if (keys.has('jump') && actor.onGround) {
    actor.vy = ACTOR.jumpVel;
    actor.onGround = false;
  }
  if (!actor.onGround) {
    actor.vy -= ACTOR.gravity * dt;
    actor.y += actor.vy * dt;
    if (actor.y <= 0) {
      actor.y = 0;
      actor.vy = 0;
      actor.onGround = true;
    }
  }

  moveActor(actor, actor.vx * dt, actor.vz * dt, colliders);
  return Math.hypot(actor.vx, actor.vz);
}
