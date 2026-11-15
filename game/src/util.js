// Neon Bazaar — small shared helpers. No allocations in the hot path: the
// functions here take scratch objects the caller reuses.

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;

/** A fast seeded RNG (mulberry32) so staged screenshots are reproducible. */
export function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Format seconds as M:SS for the round timer. */
export function fmtTime(sec) {
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Ray vs sphere. Returns the distance along the ray, or -1 on a miss. */
export function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const lx = cx - ox;
  const ly = cy - oy;
  const lz = cz - oz;
  const tca = lx * dx + ly * dy + lz * dz;
  if (tca < 0) return -1;
  const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
  const r2 = r * r;
  if (d2 > r2) return -1;
  return tca - Math.sqrt(r2 - d2);
}

/**
 * Ray vs axis-aligned box. The box is {minX, maxX, minY, maxY, minZ, maxZ}.
 * Returns the distance along the ray, or -1 on a miss.
 */
export function rayBox(ox, oy, oz, dx, dy, dz, b) {
  let tmin = 0;
  let tmax = Infinity;
  const o = [ox, oy, oz];
  const d = [dx, dy, dz];
  const mn = [b.minX, b.minY, b.minZ];
  const mx = [b.maxX, b.maxY, b.maxZ];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < mn[i] || o[i] > mx[i]) return -1;
    } else {
      let t1 = (mn[i] - o[i]) / d[i];
      let t2 = (mx[i] - o[i]) / d[i];
      if (t1 > t2) {
        const t = t1;
        t1 = t2;
        t2 = t;
      }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return -1;
    }
  }
  return tmin;
}

/** Segment (a→b) blocked by any box in `boxes`? Used for line of sight. */
export function segmentBlocked(ax, ay, az, bx, by, bz, boxes) {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-6) return false;
  const ix = dx / len;
  const iy = dy / len;
  const iz = dz / len;
  for (let i = 0; i < boxes.length; i++) {
    const t = rayBox(ax, ay, az, ix, iy, iz, boxes[i]);
    if (t >= 0 && t < len) return true;
  }
  return false;
}

/** Circle (x,z,r) pushed out of an XZ box. Returns true when a push happened. */
export function resolveCircleBox(x, z, r, b, out) {
  const cx = clamp(x, b.minX, b.maxX);
  const cz = clamp(z, b.minZ, b.maxZ);
  const dx = x - cx;
  const dz = z - cz;
  const d2 = dx * dx + dz * dz;
  if (d2 >= r * r) return false;
  if (d2 > 1e-8) {
    const d = Math.sqrt(d2);
    const push = (r - d) / d;
    out.x = x + dx * push;
    out.z = z + dz * push;
  } else {
    // Center inside the box: push out along the smallest penetration axis.
    const pl = x - b.minX + r;
    const pr = b.maxX - x + r;
    const pt = z - b.minZ + r;
    const pb = b.maxZ - z + r;
    const m = Math.min(pl, pr, pt, pb);
    out.x = m === pl ? b.minX - r : m === pr ? b.maxX + r : x;
    out.z = m === pt ? b.minZ - r : m === pb ? b.maxZ + r : z;
  }
  return true;
}
