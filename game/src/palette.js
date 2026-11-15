// Neon Bazaar — one palette for the whole game: a rain-soaked night market.
// Deep blue night, warm lantern amber, stall-sign cyan and pink, jackal
// orange. Every material and light in the game takes its colour from here,
// so the map reads as one place instead of a pile of props.

export const PALETTE = {
  night: 0x0b0e1d,
  fog: 0x0d1024,
  ground: 0x1b1f33,
  groundWet: 0x232842,
  wall: 0x2a2f47,
  wallDark: 0x1e2236,
  wood: 0x6b4a2f,
  woodDark: 0x4a3220,
  clothRed: 0x8e2f3c,
  clothTeal: 0x1f6f6b,
  clothGold: 0xb8862e,
  crate: 0x7a5c38,
  metal: 0x4a5266,
  neonCyan: 0x2ee6d6,
  neonPink: 0xff2e88,
  lantern: 0xffb347,
  jade: 0x3fae7a,
  moon: 0xbfd0ff,
  vanguard: 0x2ee6d6,
  jackal: 0xff5a3c,
  spark: 0xffd23c,
  railgun: 0x7df9ff,
};

// Neon sign texts for the market stalls. Each sign is drawn once onto a
// canvas texture at load time (see world.js) — no image files, no network.
export const SIGNS = [
  { text: '夜市', sub: 'NIGHT MARKET', color: '#ff2e88', bg: '#1a0b1e' },
  { text: '拉麺', sub: 'RAMEN', color: '#2ee6d6', bg: '#06231f' },
  { text: '香料', sub: 'SPICE COURT', color: '#ffb347', bg: '#241608' },
  { text: '茶', sub: 'TEA HOUSE', color: '#3fae7a', bg: '#071f14' },
  { text: '灯笼', sub: 'LANTERNS', color: '#ffd23c', bg: '#221a06' },
  { text: '絲綢', sub: 'SILK', color: '#ff5a3c', bg: '#220d06' },
  { text: '烧烤', sub: 'BBQ', color: '#ff7ab8', bg: '#200a18' },
  { text: '药', sub: 'HERBS', color: '#7df9ff', bg: '#061e24' },
];
