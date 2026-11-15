// Neon Bazaar — the HUD. One update per frame reads the state store and
// writes the DOM: health, armour, ammo, money, timer, score, alive counts,
// the objective line, the kill feed, the banners and the buy menu. The
// DOM is the only place the player reads the game, so every number the
// simulation owns shows here.

import { PHASE } from './state.js';
import { WEAPONS, BUYABLES } from './weapons.js';
import { fmtTime } from './util.js';

export function createHud(state) {
  const el = (id) => document.getElementById(id);
  const hud = {
    crosshair: el('crosshair'),
    hitmarker: el('hitmarker'),
    healthNum: el('health-num'),
    healthFill: el('health-fill'),
    armorVal: el('armor-val'),
    ammoMag: el('ammo-mag'),
    ammoReserve: el('ammo-reserve'),
    ammoBox: el('ammo'),
    weaponCur: el('weapon-cur'),
    weaponSub: el('weapon-sub'),
    scoreVg: el('score-vg'),
    scoreJk: el('score-jk'),
    timer: el('round-timer'),
    roundLabel: el('round-label'),
    moneyVal: el('money-val'),
    alive: el('alive'),
    objective: el('objective'),
    killfeed: el('killfeed'),
    banner: el('banner'),
    bannerTitle: el('banner-title'),
    bannerSub: el('banner-sub'),
    flash: el('flash'),
    damage: el('damage'),
    scope: el('scope'),
    overlay: el('overlay'),
    buyMenu: el('buymenu'),
    buyList: el('buy-list'),
    buyCash: el('buy-cash'),
    buyRound: el('buy-round'),
  };

  let flashT = 0;
  let flashMax = 1;
  let shakeT = 0;
  let hitT = 0;
  let hitKill = false;

  hud.showFlash = (seconds) => {
    flashT = seconds;
    flashMax = seconds;
  };
  hud.showDamage = () => {
    hud.damage.style.opacity = 0.85;
    setTimeout(() => {
      hud.damage.style.opacity = 0;
    }, 140);
  };
  hud.showHit = (headshot, kill) => {
    hud.hitmarker.classList.add('on');
    hud.hitmarker.classList.toggle('kill', kill);
    hitT = 0.12;
    hitKill = kill;
  };
  hud.showShake = (seconds) => {
    shakeT = Math.max(shakeT, seconds);
  };

  hud.showBanner = (title, sub, cls) => {
    hud.bannerTitle.textContent = title;
    hud.bannerSub.textContent = sub;
    hud.banner.className = `show ${cls}`;
  };
  hud.hideBanner = () => {
    hud.banner.className = '';
  };

  /** Build the buy menu rows once; update() refreshes their state. */
  hud.buildBuyMenu = (player) => {
    hud.buyList.innerHTML = '';
    BUYABLES.forEach((item, i) => {
      const row = document.createElement('div');
      row.className = 'buyrow';
      row.dataset.buy = item.id;
      const name = item.kind === 'weapon' ? WEAPONS[item.id].name : item.name;
      const label = item.kind === 'weapon' ? WEAPONS[item.id].label : item.label;
      const price = item.kind === 'weapon' ? WEAPONS[item.id].price : item.price;
      row.innerHTML = `<span><kbd>${i + 1}</kbd><b>${name}</b> · ${label}</span><span class="price">$${price}</span>`;
      row.addEventListener('click', () => {
        hud.onBuy?.(item.id);
      });
      hud.buyList.appendChild(row);
    });
  };
  hud.onBuy = null;

  /** The per-frame write. Cheap: only textContent and class changes. */
  hud.update = (player, dt) => {
    const weapon = WEAPONS[player.weapon];
    const ammo = player.ammo[player.weapon] ?? { mag: 0, reserve: 0 };
    hud.healthNum.textContent = String(Math.max(0, Math.ceil(player.health)));
    hud.healthNum.classList.toggle('low', player.health <= 30);
    hud.healthFill.style.width = `${Math.max(0, player.health)}%`;
    hud.healthFill.classList.toggle('low', player.health <= 30);
    hud.armorVal.textContent = String(Math.floor(player.armor));
    hud.ammoMag.textContent = String(ammo.mag);
    hud.ammoReserve.textContent = weapon.id === 'railgun' ? 'CELLS' : `/ ${ammo.reserve}`;
    hud.ammoBox.classList.toggle('empty', ammo.mag === 0);
    hud.weaponCur.textContent = weapon.name;
    hud.weaponSub.textContent = weapon.label;
    hud.scoreVg.textContent = String(state.score.VG);
    hud.scoreJk.textContent = String(state.score.JK);
    const showT = state.phaseT;
    hud.timer.textContent = fmtTime(showT);
    hud.timer.classList.toggle('urgent', state.phase === PHASE.LIVE && state.phaseT < 15);
    hud.roundLabel.textContent = `ROUND ${state.round}${state.powerRound ? ' · POWER' : ''}`;
    hud.moneyVal.textContent = String(player.money);
    const vgAlive = state.actors.filter((a) => a.team === 'VG' && a.alive).length;
    const jkAlive = state.actors.filter((a) => a.team === 'JK' && a.alive).length;
    hud.alive.innerHTML = `<span class="vg">VANGUARD ${'●'.repeat(vgAlive)}${'○'.repeat(4 - vgAlive)}</span><br><span class="jk">JACKALS ${'●'.repeat(jkAlive)}${'○'.repeat(4 - jkAlive)}</span>`;

    // Objective line: what the player should be doing right now.
    let obj;
    if (state.phase === PHASE.BUY) {
      obj = state.powerRound
        ? `<span class="power">POWER ROUND</span> — the Longshot spawns mid. Buy up, then race it.`
        : `BUY PHASE — spend your $${player.money}, then hold the sites.`;
    } else if (state.planted) {
      obj = `<span class="spark">SPARK PLANTED — ${state.plantSite}</span> · detonates in ${Math.ceil(state.detonateT)}s — DEFUSE IT (E)`;
    } else if (state.carrier) {
      const carrier = state.actors.find((a) => a.id === state.carrier);
      obj = `DEFEND THE SITES — the Spark is with <span class="spark">${carrier ? carrier.name : 'a Jackal'}</span>`;
    } else if (state.sparkDropped) {
      obj = `DEFEND THE SITES — the Spark is <span class="spark">on the ground</span>`;
    } else {
      obj = `DEFEND THE SITES — <span class="spark">SPARK NOT PLANTED</span>`;
    }
    if (state.powerRound && !state.railgunTaken && state.phase === PHASE.LIVE) {
      obj += ` · <span class="power">LONGSHOT AT MID</span>`;
    }
    hud.objective.innerHTML = obj;

    // Kill feed: the last few events, newest first.
    if (hud._feedKey !== state.events.length + (state.events[0]?.tick ?? 0)) {
      hud._feedKey = state.events.length + (state.events[0]?.tick ?? 0);
      hud.killfeed.innerHTML = state.events
        .slice(0, 5)
        .map((e) => `<div><span class="${e.cls === 'VG' ? 'vg' : e.cls === 'JK' ? 'jk' : ''}">${e.text}</span>${e.hs ? ' <span class="hs">HEADSHOT</span>' : ''}</div>`)
        .join('');
    }

    // Crosshair gap follows the spread heat.
    const gap = 6 + (player.spreadHeat ?? 0) * 5;
    hud.crosshair.style.setProperty('--gap', `${gap.toFixed(1)}px`);

    // Flash fade, hitmarker fade, scope overlay.
    if (flashT > 0) {
      flashT -= dt;
      hud.flash.style.opacity = String(Math.max(0, flashT / flashMax) * 0.9);
    } else {
      hud.flash.style.opacity = 0;
    }
    if (hitT > 0) {
      hitT -= dt;
      if (hitT <= 0) hud.hitmarker.classList.remove('on');
    }
    const scoping = player.weapon === 'marksman' && player.aiming && player.alive;
    hud.scope.style.display = scoping ? 'block' : 'none';

    // Buy menu rows: affordable, owned, or too expensive.
    if (!hud.buyMenu.hidden) {
      hud.buyCash.textContent = `$${player.money}`;
      hud.buyRound.textContent = String(state.round);
      for (const row of hud.buyList.children) {
        const item = BUYABLES.find((b) => b.id === row.dataset.buy);
        const owned = item.kind === 'weapon' ? !!player.weapons[item.id] : item.kind === 'armor' ? player.armor >= 100 : player.grenades[item.id] >= 2;
        row.classList.toggle('owned', owned);
        row.classList.toggle('cant', !owned && player.money < item.price);
      }
    }
    return shakeT > 0 ? (shakeT -= dt, 1) : 0;
  };

  return hud;
}
