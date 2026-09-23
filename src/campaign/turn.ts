/**
 * The end of a Toll: every faction is paid and fed, cities grow or riot,
 * armies heal or wither, the herds move, the Tilt creeps, and after Toll
 * 70 the Great Shudder shakes the world. Then the next Toll begins.
 */
import type { FactionId } from '../data/schema';
import { FACTION_IDS } from '../data/schema';
import { factionDef, unitDef } from '../data/index';
import type { CampaignState, FactionState, Ledger } from './types';
import { REGIONS, RESOURCES, regionDef } from './regions';
import { neighbors } from './geometry';
import { chainDef } from './buildings';
import { allied, log, relation, withRng } from './state';
import {
  armyFood,
  armyUpkeep,
  attrition,
  bandIndex,
  cityEffects,
  maxMoves,
  orderDelta,
  regionEffects,
  regionStance,
  regionYield,
  replenishRate,
  sumEffect,
} from './rules';
import { checkVictory } from './victory';
import { checkDeaths } from './battles';
import { OBSERVANCES } from './actions';

export const GREAT_SHUDDER_TOLL = 70;

/**
 * Renown for a wind-city's full migration through the five bands. A sail
 * on open Gale Roads can finish one every few Tolls, and Renown also comes
 * from raids, moorings and shrines, so it is kept modest.
 */
export const MIGRATION_RENOWN = 50;

/** Every coin, meal and point of resource a faction gains or spends this Toll. */
export function factionLedger(s: CampaignState, f: FactionId): Ledger {
  const L: Ledger = { coinIn: 0, coinOut: 0, foodIn: 0, foodOut: 0, resIn: 0, lines: [] };
  const add = (label: string, coin = 0, food = 0, res = 0) => {
    if (!coin && !food && !res) return;
    L.lines.push({ label, coin: coin || undefined, food: food || undefined, res: res || undefined });
    if (coin > 0) L.coinIn += coin;
    else L.coinOut -= coin;
    if (food > 0) L.foodIn += food;
    else L.foodOut -= food;
    L.resIn += res;
  };
  let sCoin = 0;
  let sFood = 0;
  let sRes = 0;
  for (const r of REGIONS) {
    if (s.regions[r.id]!.owner !== f) continue;
    const y = regionYield(s, r.id);
    sCoin += y.coin;
    sFood += y.food;
    sRes += y.res;
  }
  add('Settlements', sCoin, sFood, sRes);
  if (f === 'drift') {
    let mc = 0;
    let n = 0;
    for (const r of REGIONS) {
      const st = s.regions[r.id]!;
      if (!st.mooring) continue;
      n++;
      mc += 60 + Math.round(RESOURCES[r.resource].coin / 2);
    }
    add(`Moorings (${n})`, mc, 0, n);
    let cc = 0;
    let cr = 0;
    for (const a of s.armies) {
      if (a.faction !== 'drift') continue;
      // Every wind-city trades as it sails; best on the open roads.
      cc += 80 + (regionDef(a.region).galeRoad ? 40 : 0);
      const e = cityEffects(a);
      cc += sumEffect(e, 'coin');
      cr += sumEffect(e, 'res');
    }
    add('Wind-city trade', cc, 0, cr);
  }
  let trade = 0;
  for (const o of FACTION_IDS) {
    if (o === f || !s.factions[o].alive) continue;
    const rel = relation(s, f, o);
    if (rel.trade && rel.stance !== 'war') trade += 40 + Math.round(sCoin * 0.08);
  }
  add('Trade agreements', trade);
  let tribute = 0;
  for (const o of FACTION_IDS) {
    if (o === f) continue;
    const t = relation(s, f, o).tribute;
    if (!t || t.turns <= 0) continue;
    tribute += t.from === f ? -t.amount : t.amount;
  }
  add('Tribute', tribute);
  let upkeep = 0;
  let rations = 0;
  for (const a of s.armies) {
    if (a.faction !== f) continue;
    upkeep += armyUpkeep(a);
    rations += armyFood(s, a);
  }
  add('Army upkeep', -upkeep);
  add('Army rations', 0, -Math.round(rations * 10) / 10);
  if (f === 'vesperate') {
    const next = nextObservance(s);
    if (next) add(`Observance: ${OBSERVANCES[next].name}`, 0, 0, -OBSERVANCES[next].hours);
  }
  return L;
}

function nextObservance(s: CampaignState): keyof typeof OBSERVANCES | null {
  const v = s.factions.vesperate;
  return (v.calendar[(s.turn + 1) % v.calendar.length] as keyof typeof OBSERVANCES) ?? null;
}

export function ledgerNet(L: Ledger): { coin: number; food: number; res: number } {
  return { coin: L.coinIn - L.coinOut, food: L.foodIn - L.foodOut, res: L.resIn };
}

/** Everything that happens between one Toll and the next. */
export function endRound(s: CampaignState): void {
  withRng(s, (rng) => {
    // Raids: loot comes before the owner's income, which it takes.
    for (const a of s.armies) {
      if (a.stance !== 'raid' || a.fought) continue;
      const st = regionStance(s, a);
      if (st !== 'hostile') {
        a.stance = 'march';
        continue;
      }
      const r = s.regions[a.region]!;
      const own = r.owner;
      const loot = own === 'free' ? 60 + r.level * 30 : Math.round(regionYield(s, a.region).coin * 0.6) + 40;
      r.raidedBy = a.faction;
      s.factions[a.faction].coin += loot;
      if (a.faction === 'drift') s.factions.drift.res += 6;
      if (own !== 'free') relation(s, a.faction, own).opinion -= 3;
      log(s, 'battle', `${a.name} raids ${regionDef(a.region).settlement || regionDef(a.region).name} for ${loot} coin.`, a.faction === s.player || own === s.player ? s.player : undefined, a.region);
    }

    // Economy.
    for (const f of FACTION_IDS) {
      const fs = s.factions[f];
      if (!fs.alive) continue;
      const L = factionLedger(s, f);
      fs.last = L;
      const net = ledgerNet(L);
      fs.coin += net.coin;
      fs.food = Math.min(400, fs.food + net.food);
      if (f === 'vesperate') {
        const next = nextObservance(s);
        const cost = next ? OBSERVANCES[next].hours : 0;
        fs.res += net.res + cost;
        if (fs.res >= cost) fs.res -= cost;
        else if (next) {
          log(s, 'warning', `Too few Hours: the ${OBSERVANCES[next].name} Observance lapses.`, 'vesperate');
          fs.lapsed = s.turn + 1;
        }
      } else fs.res += net.res;
      if (f === 'hush') fs.res = Math.min(100, fs.res);
      if (fs.coin < 0) {
        for (const a of s.armies) if (a.faction === f) for (const u of a.units) u.strength *= 0.95;
        log(s, 'warning', `${factionDef(f).name} cannot pay their troops: soldiers desert.`, f);
      }
      if (fs.food < 0) log(s, 'warning', `${factionDef(f).name} are starving: armies wither and cities riot.`, f);
      // Tribute counts down.
      for (const o of FACTION_IDS) {
        if (o === f) continue;
        const t = relation(s, f, o).tribute;
        if (t && t.from === f && t.turns > 0) t.turns--;
      }
    }

    // Construction, growth, order and revolts.
    for (const r of REGIONS) {
      const st = s.regions[r.id]!;
      for (const sl of st.slots) {
        if (!sl?.building) continue;
        sl.building.turnsLeft--;
        if (sl.building.turnsLeft <= 0) {
          sl.level = sl.building.toLevel;
          sl.building = undefined;
          const c = chainDef(sl.chain);
          if (st.owner !== 'free') log(s, 'build', `${c.names[sl.level - 1]} completed in ${r.settlement}.`, st.owner, r.id);
          if (st.owner === 'vesperate') s.factions.vesperate.houses.weir = Math.min(100, s.factions.vesperate.houses.weir + 1);
        }
      }
      st.slots = st.slots.map((x) => (x && x.level <= 0 && !x.building ? null : x));
      if (st.garrisonLoss) st.garrisonLoss = Math.max(0, st.garrisonLoss - 0.15);
      if (st.ritualCooldown) st.ritualCooldown--;
      if (st.nightfall) st.nightfall--;
      if (st.owner === 'free') {
        st.raidedBy = undefined;
        continue;
      }
      const fs = s.factions[st.owner];
      const growth = 1 + sumEffect(regionEffects(st), 'growth') + (fs.food > 0 ? 1 : 0) - (st.order < -10 ? 1 : 0);
      st.growth = Math.max(0, st.growth + growth);
      st.order = Math.max(-20, Math.min(20, st.order + orderDelta(s, r.id)));
      st.raidedBy = undefined;
      if (st.order <= -20) revolt(s, r.id);
    }

    // Armies: heal, wither, march again.
    for (const a of s.armies) {
      const rate = replenishRate(s, a) / 100;
      const att = attrition(s, a);
      for (const u of a.units) {
        u.strength = Math.min(1, u.strength + rate);
        if (att.pct) u.strength -= att.pct / 100;
      }
      if (att.pct) {
        const lost = a.units.filter((u) => u.strength < 0.05);
        if (lost.length) log(s, 'loss', `${a.name} loses ${lost.length} unit${lost.length > 1 ? 's' : ''} to attrition (${att.why}).`, a.faction, a.region);
        for (const u of lost) if (unitDef(u.def).category === 'colossus') s.factions[a.faction].colossus.alive = false;
        a.units = a.units.filter((u) => u.strength >= 0.05);
      }
      a.moves = maxMoves(a);
      a.fought = false;
      if (a.shadowed && !regionDef(a.region).vale) a.shadowed = false;
      if (a.crusade) {
        a.crusade.turns--;
        if (a.crusade.turns <= 0 || s.regions[a.crusade.target]!.owner === 'choir') {
          log(s, 'info', `${a.name}'s crusade ends.`, 'choir');
          a.crusade = undefined;
        }
      }
      if (a.city) {
        for (const sl of a.city.slots) {
          if (!sl?.building) continue;
          sl.building.turnsLeft--;
          if (sl.building.turnsLeft <= 0) {
            sl.level = sl.building.toLevel;
            sl.building = undefined;
          }
        }
      }
      if (a.faction === 'drift') {
        const b = bandIndex(s, a.region);
        a.bandsVisited = a.bandsVisited ?? [];
        if (!a.bandsVisited.includes(b)) a.bandsVisited.push(b);
        if (a.bandsVisited.length >= 5) {
          s.factions.drift.res += MIGRATION_RENOWN;
          s.factions.drift.migrations++;
          a.bandsVisited = [b];
          log(s, 'victory', `${a.name} completes a full migration through all five bands: +${MIGRATION_RENOWN} Renown.`, undefined, a.region);
        }
      }
    }

    // Faction mechanics.
    const choir = s.factions.choir;
    choir.zeal = Math.max(0, choir.zeal - 1);
    if (choir.hymn) {
      choir.hymn.turns--;
      if (choir.hymn.turns <= 0) choir.hymn = undefined;
    }
    if (choir.lensBuilding) {
      choir.lensBuilding = false;
      choir.lens++;
      s.tiltProgress += 10;
      log(s, 'victory', `Stage ${choir.lens} of the Last Lens is raised at the Nail Spire.`);
    }
    const hush = s.factions.hush;
    const trophies = REGIONS.some((r) => s.regions[r.id]!.owner === 'hush' && s.regions[r.id]!.slots.some((x) => x && x.level > 0 && chainDef(x.chain).kind === 'tower'));
    hush.res = Math.max(0, hush.res - (trophies ? 1 : 2));
    moveHerds(s, rng.next.bind(rng));
    const ves = s.factions.vesperate;
    if (ves.greatTollCooldown > 0) ves.greatTollCooldown--;
    if (ves.alive) houses(s, rng.next.bind(rng));

    // Legendary lords return to the field.
    for (const f of FACTION_IDS) {
      const fs = s.factions[f];
      if (fs.lordReturns === undefined || fs.lordReturns > s.turn + 1) continue;
      if (s.armies.some((a) => a.faction === f && a.lord.legendary)) {
        fs.lordReturns = undefined;
        continue;
      }
      const host = s.armies.filter((a) => a.faction === f).sort((x, y) => y.units.length - x.units.length)[0];
      if (!host) continue;
      const fd = factionDef(f);
      host.lord = { name: fd.lord.name, def: fd.lord.id, legendary: true, traits: host.lord.traits, wins: 0 };
      fs.lordReturns = undefined;
      log(s, 'info', `${fd.lord.name} returns and takes command of ${host.name}.`, undefined, host.region);
    }

    // The Tilt.
    let push = 0;
    for (const r of REGIONS) {
      const st = s.regions[r.id]!;
      if (st.owner === 'free') continue;
      push += sumEffect(regionEffects(st), 'tilt');
    }
    s.tiltProgress += push;
    stepTilt(s);

    // The Great Shudder.
    if (!s.winner && s.turn + 1 >= GREAT_SHUDDER_TOLL) {
      if (!s.shudder.active) {
        s.shudder.active = true;
        s.shudder.next = s.turn + 3;
        log(s, 'shudder', 'The Great Shudder begins. The sun lurches in its socket; the world will not hold still.');
      }
      if (s.turn >= s.shudder.next) {
        s.shudder.next = s.turn + 3;
        const dir = rng.chance(0.5) ? 1 : -1;
        const before = s.tilt;
        s.tilt = Math.max(-5, Math.min(5, s.tilt + dir));
        if (s.tilt !== before) log(s, 'shudder', `The Shudder throws the Tilt ${dir > 0 ? 'sunward' : 'nightward'} to ${s.tilt > 0 ? '+' : ''}${s.tilt}.`);
      }
      if (s.shudder.stillness > 0) s.shudder.stillness--;
      else if (rng.chance(0.2)) {
        s.shudder.stillness = 2;
        log(s, 'shudder', 'Stillness: the wind dies everywhere. Drift gliders are grounded.');
      }
      if (rng.chance(0.25)) {
        const pool = REGIONS.filter((r) => !s.regions[r.id]!.nightfall);
        for (let i = 0; i < 2 && pool.length; i++) {
          const r = pool.splice(rng.int(pool.length), 1)[0]!;
          s.regions[r.id]!.nightfall = 3;
          log(s, 'shudder', `Sudden Nightfall over ${r.name}.`, undefined, r.id);
        }
      }
    }

    // Opinions fade toward neutral.
    for (const k in s.relations) {
      const rel = s.relations[k]!;
      rel.opinion += rel.opinion > 0 ? -1 : rel.opinion < 0 ? 1 : 0;
      rel.opinion = Math.max(-100, Math.min(100, rel.opinion));
    }
  });
  checkDeaths(s);
  checkVictory(s);
  s.turn++;
}

export function stepTilt(s: CampaignState): void {
  while (s.tiltProgress >= 100 || s.tiltProgress <= -100) {
    const dir = s.tiltProgress > 0 ? 1 : -1;
    if ((dir > 0 && s.tilt >= 5) || (dir < 0 && s.tilt <= -5)) {
      s.tiltProgress = dir * 99;
      break;
    }
    const before = REGIONS.map((r) => bandIndex(s, r.id));
    s.tilt += dir;
    s.tiltProgress -= dir * 100;
    const flipped = REGIONS.filter((r, i) => bandIndex(s, r.id) !== before[i]).map((r) => r.name);
    const where = flipped.length ? ` ${flipped.join(', ')} ${flipped.length > 1 ? 'change' : 'changes'} band.` : '';
    log(s, 'tilt', `The Tilt moves ${dir > 0 ? 'sunward' : 'nightward'} to ${s.tilt > 0 ? '+' : ''}${s.tilt}.${where}`);
  }
}

function revolt(s: CampaignState, id: string): void {
  const st = s.regions[id]!;
  const prev = st.owner;
  st.owner = 'free';
  st.order = 0;
  st.takenTurn = s.turn;
  st.garrisonLoss = 0;
  if (prev !== 'free') log(s, 'revolt', `${regionDef(id).settlement} revolts against ${factionDef(prev).name} and declares itself free.`, undefined, id);
}

/** The Long Hunt: herds wander the dark lands and shrink when overhunted. */
function moveHerds(s: CampaignState, rnd: () => number): void {
  const h = s.factions.hush;
  for (const herd of h.herds) {
    let hunters = 0;
    if (s.regions[herd.region]!.owner === 'hush') hunters++;
    hunters += s.armies.filter((a) => a.region === herd.region && a.faction === 'hush').length;
    herd.hunted = hunters;
    if (hunters >= 2) herd.size = Math.max(1, herd.size - 1);
    else if (hunters === 0 && rnd() < 0.5) herd.size = Math.min(6, herd.size + 1);
    // Migrate to a dark neighbor; lodges draw them.
    const opts = neighbors(herd.region).filter((n) => bandIndex(s, n) <= 1);
    if (!opts.length) {
      const any = REGIONS.filter((r) => bandIndex(s, r.id) <= 1);
      if (any.length) herd.region = any[Math.floor(rnd() * any.length)]!.id;
      continue;
    }
    if (rnd() < 0.35) continue;
    const weights = opts.map((n) => {
      const st = s.regions[n]!;
      const lodge = st.owner === 'hush' ? sumEffect(regionEffects(st), 'herdFood') : 0;
      return 1 + lodge * 1.5;
    });
    let t = rnd() * weights.reduce((x, y) => x + y, 0);
    for (let i = 0; i < opts.length; i++) {
      t -= weights[i]!;
      if (t <= 0) {
        herd.region = opts[i]!;
        break;
      }
    }
  }
}

/** The three Houses drift, sulk, and sometimes secede. */
function houses(s: CampaignState, rnd: () => number): void {
  const v = s.factions.vesperate;
  const hs = v.houses;
  const guild = REGIONS.filter((r) => s.regions[r.id]!.owner === 'vesperate').reduce((t, r) => t + s.regions[r.id]!.slots.filter((x) => x && x.level > 0 && x.chain === 'vesperate.guildhall').length, 0);
  const atWar = FACTION_IDS.some((o) => o !== 'vesperate' && s.factions[o].alive && relation(s, 'vesperate', o).stance === 'war');
  hs.carillon += (atWar ? 1 : -1) + guild * 0.5;
  hs.lantern += (v.last && v.last.coinIn > 700 ? 1 : -1) + guild * 0.5;
  hs.weir += -0.5 + guild * 0.5;
  for (const k of ['carillon', 'lantern', 'weir'] as const) {
    hs[k] = Math.max(0, Math.min(100, hs[k] + (hs[k] > 50 ? -0.5 : 0.5)));
    if ((hs[k] < 15 || hs[k] > 92) && rnd() < 0.25) {
      const towns = REGIONS.filter((r) => s.regions[r.id]!.owner === 'vesperate' && r.id !== 'vesper' && !s.armies.some((a) => a.region === r.id && a.faction === 'vesperate'));
      if (!towns.length) continue;
      const t = towns[Math.floor(rnd() * towns.length)]!;
      s.regions[t.id]!.owner = 'free';
      s.regions[t.id]!.takenTurn = s.turn;
      hs[k] = 50;
      log(s, 'revolt', `House ${k[0]!.toUpperCase()}${k.slice(1)} ${hs[k] > 50 ? 'grows too proud' : 'is slighted'} and takes ${t.settlement} out of the Vesperate.`, undefined, t.id);
    }
  }
}

/** Tolls until the next Great Shudder event, for the UI. */
export function shudderIn(s: CampaignState): number {
  return Math.max(0, GREAT_SHUDDER_TOLL - s.turn);
}

export function isAlliedWith(s: CampaignState, a: FactionId, b: FactionId): boolean {
  return allied(s, a, b);
}

export type { FactionState };
