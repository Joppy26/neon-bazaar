// Neon Bazaar — navigation. The waypoint graph lives in world.js; this
// module answers the one question bots ask: how do I get from here to there?
// Breadth-first search over the graph, plus a nearest-node lookup and a
// straight-line check so bots cut corners when the way is clear.

import { segmentBlocked } from './util.js';

/** The nearest waypoint id to (x, z). */
export function nearestNode(waypoints, x, z) {
  let best = null;
  let bestD = Infinity;
  for (const [id, node] of Object.entries(waypoints)) {
    const d = (node.x - x) * (node.x - x) + (node.z - z) * (node.z - z);
    if (d < bestD) {
      bestD = d;
      best = id;
    }
  }
  return best;
}

/** A route (list of {x, z}) from (x, z) to target node id, via BFS. */
export function findRoute(waypoints, fromX, fromZ, targetId) {
  const start = nearestNode(waypoints, fromX, fromZ);
  if (start === targetId) return [{ x: waypoints[targetId].x, z: waypoints[targetId].z }];
  const prev = { [start]: null };
  const queue = [start];
  while (queue.length > 0) {
    const cur = queue.shift();
    if (cur === targetId) break;
    for (const next of waypoints[cur].links) {
      if (!(next in prev)) {
        prev[next] = cur;
        queue.push(next);
      }
    }
  }
  if (!(targetId in prev)) return null;
  const nodes = [];
  let cur = targetId;
  while (cur !== null) {
    nodes.unshift(cur);
    cur = prev[cur];
  }
  return nodes.map((id) => ({ x: waypoints[id].x, z: waypoints[id].z }));
}

/**
 * Shorten a route: drop any intermediate point the actor can reach in a
 * straight line without crossing a collider. Called when a new route is
 * set and again when the actor reaches a waypoint.
 */
export function shortcutRoute(route, x, z, colliders, eyeY = 1.4) {
  if (!route || route.length < 2) return route;
  const out = [];
  let cx = x;
  let cz = z;
  for (let i = 0; i < route.length; i++) {
    const p = route[i];
    // Look ahead: skip this point when the one after it is directly visible.
    if (i + 1 < route.length) {
      const next = route[i + 1];
      if (!segmentBlocked(cx, eyeY, cz, next.x, eyeY, next.z, colliders)) {
        continue;
      }
    }
    out.push(p);
    cx = p.x;
    cz = p.z;
  }
  if (out.length === 0) out.push(route[route.length - 1]);
  return out;
}
