// Neon Bazaar — the one state store. Every module reads and writes this
// object; no module keeps its own copy of round, score or money. The fixed
// step in main.js advances `tick`, and the render reads the same store.

export const TEAMS = {
  VG: 'VG', // Vanguard — defenders, cyan
  JK: 'JK', // Jackals — attackers, orange
};

export const PHASE = {
  BUY: 'buy',
  LIVE: 'live',
  END: 'end',
  MATCH: 'match',
};

export const WIN_ROUNDS = 5;
export const BUY_SECONDS = 15;
export const ROUND_SECONDS = 100;
export const PLANT_SECONDS = 3;
export const DEFUSE_SECONDS = 4;
export const DETONATE_SECONDS = 35;
export const END_SECONDS = 5;

// Economy: kills pay, wins pay more than losses, and a losing streak pays a
// little extra so a team that is behind can still buy back in.
export const ECON = {
  start: 800,
  kill: 300,
  win: 3250,
  loss: 1900,
  lossStreak: 500,
  maxLossStreak: 2,
  plant: 300,
};

/** A fresh match. `actors` holds the player (index 0) and the seven bots. */
export function freshState() {
  return {
    tick: 0,
    time: 0,
    phase: PHASE.BUY,
    phaseT: BUY_SECONDS,
    round: 1,
    score: { VG: 0, JK: 0 },
    lossStreak: { VG: 0, JK: 0 },
    planted: false,
    plantSite: null,
    plantT: 0,
    detonateT: 0,
    carrier: null, // actor id carrying the Spark
    sparkDropped: null, // {x, z} when the carrier died mid-round
    powerRound: false, // every 3rd round: the Longshot railgun spawns mid
    railgunTaken: false,
    railgunHolder: null,
    actors: [],
    events: [], // {tick, text, cls} for the kill feed, newest first
    winner: null, // team that won the last round
    winReason: '',
    matchWinner: null,
    muted: false,
    spectate: null, // actor id the camera follows when the player is dead
  };
}

/** Money helpers — the only places cash changes. */
export function awardMoney(state, team, amount) {
  for (const a of state.actors) if (a.team === team && a.alive) a.money += amount;
}
export function awardKiller(state, killer) {
  if (killer) killer.money += ECON.kill;
}
