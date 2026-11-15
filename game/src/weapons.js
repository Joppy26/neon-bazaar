// Neon Bazaar — weapons. Five guns plus three grenades, all defined as
// data so the buy menu, the HUD and the firing code read the same numbers.
// The railgun (ARC-9 Longshot) is not bought: one spawns on the mid plaza
// every third round and the first actor to reach it keeps it.

export const WEAPONS = {
  pistol: {
    id: 'pistol', slot: 1, name: 'P9', kind: 'pistol', label: 'SIDEARM',
    price: 0, damage: 26, headMult: 3, mag: 12, reserve: 48,
    interval: 0.16, auto: false, spread: 0.9, heat: 0.5, reload: 1.1,
    range: 45, kick: 0.011, moveSpeed: 1,
  },
  smg: {
    id: 'smg', slot: 2, name: 'VK-9', kind: 'smg', label: 'SMG',
    price: 1500, damage: 22, headMult: 2.5, mag: 30, reserve: 90,
    interval: 0.075, auto: true, spread: 1.6, heat: 0.35, reload: 1.6,
    range: 32, kick: 0.008, moveSpeed: 1,
  },
  rifle: {
    id: 'rifle', slot: 3, name: 'AR-77', kind: 'rifle', label: 'RIFLE',
    price: 2700, damage: 30, headMult: 3, mag: 30, reserve: 90,
    interval: 0.11, auto: true, spread: 0.7, heat: 0.4, reload: 1.9,
    range: 55, kick: 0.014, moveSpeed: 0.96,
  },
  marksman: {
    id: 'marksman', slot: 4, name: 'LW-50', kind: 'marksman', label: 'LONG RIFLE',
    price: 4750, damage: 85, headMult: 2, mag: 5, reserve: 15,
    interval: 1.1, auto: false, spread: 0.15, hipSpread: 2.6, heat: 1.6, reload: 2.6,
    range: 80, kick: 0.05, moveSpeed: 0.92, scoped: true,
  },
  railgun: {
    id: 'railgun', slot: 5, name: 'ARC-9', kind: 'railgun', label: 'LONGSHOT · PROTOTYPE',
    price: 0, damage: 150, headMult: 1.5, mag: 5, reserve: 0,
    interval: 1.2, auto: false, spread: 0.05, heat: 1.2, reload: 2.2,
    range: 90, kick: 0.07, moveSpeed: 0.9, pierce: true,
  },
};

export const BUYABLES = [
  { id: 'rifle', kind: 'weapon' },
  { id: 'smg', kind: 'weapon' },
  { id: 'marksman', kind: 'weapon' },
  { id: 'armor', kind: 'armor', name: 'Kevlar Vest', label: 'ARMOR · 100', price: 650 },
  { id: 'frag', kind: 'grenade', name: 'Frag Grenade', label: 'FRAG · 90 DMG', price: 300 },
  { id: 'smoke', kind: 'grenade', name: 'Smoke Grenade', label: 'SMOKE · 15S', price: 300 },
  { id: 'flash', kind: 'grenade', name: 'Flash Grenade', label: 'FLASH · BLINDS', price: 200 },
];

export const GRENADES = {
  frag: { fuse: 1.4, radius: 6.5, damage: 90 },
  smoke: { fuse: 1.0, radius: 5, duration: 15 },
  flash: { fuse: 1.1, radius: 14, blind: 2.2 },
};

/** Give an actor a weapon with a full magazine and its reserve. */
export function giveWeapon(actor, weaponId) {
  const w = WEAPONS[weaponId];
  actor.weapons[weaponId] = true;
  actor.ammo[weaponId] = { mag: w.mag, reserve: w.reserve };
  actor.weapon = weaponId;
  actor.spreadHeat = 0;
  actor.fireT = 0;
  actor.reloadT = 0;
}

/** A fresh loadout: pistol plus, for bots, a bought primary. */
export function freshLoadout(actor, primaryId) {
  actor.weapons = {};
  actor.ammo = {};
  actor.grenades = { frag: 0, smoke: 0, flash: 0 };
  actor.armor = 0;
  giveWeapon(actor, 'pistol');
  if (primaryId && primaryId !== 'pistol') giveWeapon(actor, primaryId);
}
