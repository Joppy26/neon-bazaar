// Neon Bazaar — rounds. Buy phase, live play, detonation and defuse, win
// and loss money, the next round, the match. One module owns every phase
// change so the score and the economy can never drift apart.

import { PHASE, WIN_ROUNDS, BUY_SECONDS, ROUND_SECONDS, DETONATE_SECONDS, END_SECONDS, ECON } from './state.js';
import { WEAPONS, BUYABLES, freshLoadout, giveWeapon } from './weapons.js';
import { assignSites } from './bots.js';
import { createActor } from './actors.js';

const BOT_NAMES = {
  VG: ['Mira', 'Kestrel', 'Banyu'],
  JK: ['Rook', 'Vex', 'Sable', 'Onyx'],
};

/** Build the eight actors and place them at their spawns. */
export function setupMatch(state, world, scene) {
  const actors = [];
  const player = createActor('VG', 'You', true, 'rifle');
  actors.push(player);
  for (const name of BOT_NAMES.VG) actors.push(createActor('VG', name, false, 'rifle'));
  for (const name of BOT_NAMES.JK) actors.push(createActor('JK', name, false, 'rifle'));
  state.actors = actors;
  for (const a of actors) {
    if (a.mesh) scene.add(a.mesh);
  }
  startRound(state, world);
}

/** Reset positions, loadouts and the Spark for a new round. */
export function startRound(state, world) {
  state.phase = PHASE.BUY;
  state.phaseT = BUY_SECONDS;
  state.planted = false;
  state.plantSite = null;
  state.detonateT = 0;
  state.carrier = null;
  state.sparkDropped = null;
  state.railgunTaken = false;
  state.railgunHolder = null;
  state.railgunDropped = null;
  state.winner = null;
  state.winReason = '';
  state.pendingWin = null;
  state.powerRound = state.round % 3 === 0;
  state.spectate = null;
  const used = { VG: 0, JK: 0 };
  for (const a of state.actors) {
    const spawn = world.spawns[a.team][used[a.team] % 4];
    used[a.team]++;
    a.x = spawn.x;
    a.z = spawn.z;
    a.y = 0;
    a.vx = 0;
    a.vy = 0;
    a.vz = 0;
    a.yaw = spawn.yaw;
    a.pitch = 0;
    a.alive = true;
    a.health = 100;
    a.crouched = false;
    a.spreadHeat = 0;
    a.fireT = 0;
    a.reloadT = 0;
    freshLoadout(a, a.isPlayer ? 'rifle' : pickBotPrimary(a));
    if (a.bot) {
      a.bot.state = 'idle';
      a.bot.route = null;
      a.bot.target = null;
      a.bot.plantT = 0;
      a.bot.defuseT = 0;
      a.bot.blindT = 0;
      a.bot.investigate = null;
    }
  }
  assignSites(state, Math.random);
  state.events.unshift({ tick: state.tick, text: state.powerRound ? `ROUND ${state.round} — POWER ROUND: the Longshot spawns mid` : `ROUND ${state.round}`, cls: '', hs: false });
  if (state.events.length > 6) state.events.length = 6;
}

/** Bots buy like players do: rifles when rich, SMGs when poor. */
function pickBotPrimary(bot) {
  if (bot.money >= 4750 && Math.random() < 0.25) return 'marksman';
  if (bot.money >= 2700) return 'rifle';
  if (bot.money >= 1500) return 'smg';
  return 'pistol';
}

/** Buy one item for the player. Returns true when the purchase landed. */
export function buyItem(state, player, buyId, audio) {
  if (state.phase !== PHASE.BUY) return false;
  const item = BUYABLES.find((b) => b.id === buyId);
  if (!item) return false;
  if (item.kind === 'weapon') {
    const w = WEAPONS[item.id];
    if (player.weapons[item.id] || player.money < w.price) return false;
    player.money -= w.price;
    giveWeapon(player, item.id);
  } else if (item.kind === 'armor') {
    if (player.armor >= 100 || player.money < item.price) return false;
    player.money -= item.price;
    player.armor = 100;
  } else if (item.kind === 'grenade') {
    if (player.grenades[item.id] >= 2 || player.money < item.price) return false;
    player.money -= item.price;
    player.grenades[item.id]++;
  }
  audio.buy();
  return true;
}

/** End a round: score, money, streaks, and either the next round or the match. */
export function endRound(state, winner, reason, world, audio) {
  state.winner = winner;
  state.winReason = reason;
  state.score[winner]++;
  const loser = winner === 'VG' ? 'JK' : 'VG';
  state.lossStreak[loser] = Math.min(ECON.maxLossStreak, state.lossStreak[loser] + 1);
  state.lossStreak[winner] = 0;
  for (const a of state.actors) {
    if (a.team === winner) a.money += ECON.win;
    else a.money += ECON.loss + ECON.lossStreak * (state.lossStreak[loser] - 1);
  }
  state.phase = PHASE.END;
  state.phaseT = END_SECONDS;
  const playerWon = winner === 'VG';
  if (playerWon) audio.roundWin();
  else audio.roundLose();
  state.events.unshift({ tick: state.tick, text: `${winner === 'VG' ? 'VANGUARD' : 'JACKALS'} take round ${state.round} — ${reason}`, cls: winner, hs: false });
  if (state.events.length > 6) state.events.length = 6;
}

/** The round clock and the win conditions, checked every fixed step. */
export function stepRound(state, dt, world, audio) {
  if (state.pendingWin) {
    const w = state.pendingWin;
    state.pendingWin = null;
    endRound(state, w.team, w.reason, world, audio);
    return;
  }
  if (state.phase === PHASE.BUY) {
    state.phaseT -= dt;
    if (state.phaseT <= 0) {
      state.phase = PHASE.LIVE;
      state.phaseT = ROUND_SECONDS;
    }
    return;
  }
  if (state.phase === PHASE.LIVE) {
    state.phaseT -= dt;
    // Detonation: the planted Spark ends the round for the attackers.
    if (state.planted) {
      state.detonateT -= dt;
      if (state.detonateT <= 0) {
        state.planted = false;
        endRound(state, 'JK', 'Spark detonated', world, audio);
        return;
      }
    }
    const vgAlive = state.actors.some((a) => a.team === 'VG' && a.alive);
    const jkAlive = state.actors.some((a) => a.team === 'JK' && a.alive);
    if (!vgAlive) {
      endRound(state, 'JK', state.planted ? 'Vanguard eliminated' : 'Vanguard eliminated', world, audio);
      return;
    }
    if (!jkAlive) {
      endRound(state, 'VG', state.planted ? 'Jackals eliminated — Spark disarmed' : 'Jackals eliminated', world, audio);
      return;
    }
    if (state.phaseT <= 0) {
      // Time out: defenders win unless the Spark is planted and ticking.
      if (!state.planted) endRound(state, 'VG', 'Time expired — sites held', world, audio);
      return;
    }
    return;
  }
  if (state.phase === PHASE.END) {
    state.phaseT -= dt;
    if (state.phaseT <= 0) {
      if (state.score.VG >= WIN_ROUNDS || state.score.JK >= WIN_ROUNDS) {
        state.matchWinner = state.score.VG >= WIN_ROUNDS ? 'VG' : 'JK';
        state.phase = PHASE.MATCH;
        state.phaseT = 0;
      } else {
        state.round++;
        startRound(state, world);
      }
    }
  }
}
