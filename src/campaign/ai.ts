/**
 * Scripted campaign AI: one pass per faction per Toll. It builds, recruits,
 * picks targets it can beat, uses its faction's mechanics and answers
 * diplomacy in character. It is the fallback when Jev is off or offline,
 * and it plays every faction in headless test campaigns.
 */
import type { FactionId } from '../data/schema';
import { FACTION_IDS } from '../data/schema';
import { unitDef } from '../data/index';
import type { ArmyState, CampaignState, PendingBattle } from './types';
import { CANDLES, KITE_FIELDS, NAIL_SPIRE, POLE, REGIONS, regionDef } from './regions';
import { neighbors, stepsFrom } from './geometry';
import { chainDef, factionChains, type ChainKind } from './buildings';
import { atWar, factionArmies, hostile, ownedRegions, relation } from './state';
import {
  armyPower,
  armyUpkeep,
  bandIndex,
  chainLevel,
  findPath,
  reachable,
  regionStance,
} from './rules';
import {
  MAX_UNITS,
  assault,
  build,
  buildOptions,
  canRaiseArmy,
  canUpgradeSettlement,
  cityBuild,
  cityBuildOptions,
  crusade,
  demandTribute,
  extinguish,
  greatToll,
  hostileArmiesIn,
  hostileSettlement,
  listen,
  moveArmy,
  pilgrimage,
  raiseArmy,
  recruit,
  recruitOptions,
  relight,
  buildLensStage,
  lensReady,
  setStance,
  singHymn,
  upgradeCity,
  upgradeSettlement,
  buyTrait,
  TRAITS,
} from './actions';
import { garrisonPower, defenderPower, attackerPower, sunForAttacker } from './battles';
import { declareWar, factionStrength, propose } from './diplomacy';
import type { AiContext } from './controller';
import { factionLedger, ledgerNet } from './turn';

const DOCTRINE_ROLES: Record<FactionId, Record<string, number>> = {
  choir: { line: 3, antiLarge: 2, shock: 1.2, missile: 3, missileCav: 1, shockCav: 1, monster: 0.6, artillery: 1.2, hero: 0.5 },
  hush: { line: 3, antiLarge: 2, shock: 1.6, missile: 2.4, support: 1, shockCav: 2, flyer: 1, monster: 0.6, artillery: 1, hero: 0.5 },
  vesperate: { line: 3, antiLarge: 2.6, shock: 1.2, missile: 2.6, missileCav: 1, shockCav: 1.2, artillery: 1.6, support: 0.8, hero: 0.5 },
  drift: { line: 2, antiLarge: 2.4, shock: 1.4, missile: 2.4, missileCav: 2.4, shockCav: 1.4, flyer: 1, support: 0.8, artillery: 1, hero: 0.5 },
};

const BUILD_PRIORITY: Record<FactionId, ChainKind[]> = {
  choir: ['market', 'farm', 'barracks', 'range', 'tower', 'special', 'shrine', 'walls', 'stables', 'foundry', 'wonder'],
  hush: ['farm', 'market', 'barracks', 'range', 'stables', 'special', 'shrine', 'tower', 'walls', 'foundry', 'wonder'],
  vesperate: ['farm', 'market', 'tower', 'barracks', 'range', 'walls', 'special', 'shrine', 'foundry', 'stables', 'wonder'],
  drift: ['market', 'farm', 'barracks', 'range', 'stables', 'kites', 'shrine', 'sails', 'foundry', 'wonder'],
};

export async function scriptedAI(s: CampaignState, f: FactionId, ctx: AiContext): Promise<void> {
  diplomacy(s, f);
  economy(s, f);
  mechanics(s, f);
  recruitAll(s, f);
  const battles = military(s, f);
  if (battles.length) await ctx.battles(battles);
  afterBattles(s, f);
}

// ------------------------------------------------------------------ economy

function reserve(s: CampaignState, f: FactionId): number {
  const net = ledgerNet(factionLedger(s, f)).coin;
  return Math.max(200, -net * 3);
}

function economy(s: CampaignState, f: FactionId): void {
  const fs = s.factions[f];
  if (f === 'drift') {
    for (const a of factionArmies(s, f)) {
      if (!a.city) continue;
      if (a.city.level < 3 && fs.coin > 2500) upgradeCity(s, a.id);
      const order = BUILD_PRIORITY.drift;
      for (let i = 0; i < a.city.slots.length; i++) {
        const opts = cityBuildOptions(s, a.id, i).filter((o) => o.ok && fs.coin - o.cost > reserve(s, f));
        opts.sort((x, y) => order.indexOf(x.chain.kind) - order.indexOf(y.chain.kind));
        if (opts[0]) {
          cityBuild(s, a.id, i, opts[0].chain.id);
          break;
        }
      }
    }
    return;
  }
  const regions = ownedRegions(s, f).sort((a, b) => Number(regionDef(b).major) - Number(regionDef(a).major));
  for (const id of regions) {
    const r = s.regions[id]!;
    if (canUpgradeSettlement(s, id).ok && fs.coin > 1200) upgradeSettlement(s, id);
    if (r.slots.some((x) => x?.building)) continue;
    const order = [...BUILD_PRIORITY[f]];
    // Food first when starving; walls first on the border.
    if (fs.food < 5) order.unshift('farm');
    const border = neighbors(id).some((n) => {
      const o = s.regions[n]!.owner;
      return o !== f && o !== 'free' && atWar(s, f, o);
    });
    if (border) order.splice(2, 0, 'walls');
    let done = false;
    // Upgrade existing buildings first, then fill empty slots.
    for (let i = 0; i < r.slots.length && !done; i++) {
      const cur = r.slots[i];
      if (!cur) continue;
      const opt = buildOptions(s, id, i).find((o) => o.ok && fs.coin - o.cost > reserve(s, f));
      const kind = chainDef(cur.chain).kind;
      if (opt && order.indexOf(kind) < 7) {
        build(s, id, i, opt.chain.id);
        done = true;
      }
    }
    for (let i = 0; i < r.slots.length && !done; i++) {
      if (r.slots[i]) continue;
      const opts = buildOptions(s, id, i).filter((o) => o.ok && fs.coin - o.cost > reserve(s, f));
      opts.sort((x, y) => order.indexOf(x.chain.kind) - order.indexOf(y.chain.kind));
      const pick = opts.find((o) => o.chain.kind !== 'wonder' || fs.coin > 5000);
      if (pick) {
        build(s, id, i, pick.chain.id);
        done = true;
      }
    }
  }
}

// ------------------------------------------------------------- recruitment

function recruitAll(s: CampaignState, f: FactionId): void {
  const fs = s.factions[f];
  const net = ledgerNet(factionLedger(s, f)).coin;
  for (const a of factionArmies(s, f)) {
    let guard = 0;
    while (a.units.length < MAX_UNITS && guard++ < 16) {
      const opts = recruitOptions(s, a.id).filter((o) => o.ok);
      if (!opts.length) break;
      const budget = fs.coin - Math.max(250, -net * 2);
      const affordable = opts.filter((o) => o.coin <= budget && (o.def.category !== 'colossus' || fs.coin > 4000));
      if (!affordable.length) break;
      // Upkeep must stay payable.
      const upkeepAfter = armyUpkeep(a) + affordable[0]!.def.cost * 0.06;
      if (net - upkeepAfter * 0.2 < -150 && a.units.length >= 8) break;
      const pick = weightedPick(s, f, a, affordable.map((o) => o.def.id));
      if (!pick) break;
      if (!recruit(s, a.id, pick).ok) break;
    }
    // Equip lords for the bands they fight in.
    for (const t of Object.keys(TRAITS)) {
      if (TRAITS[t]!.faction === f && fs.coin > 2500 && !a.lord.traits.includes(t)) buyTrait(s, a.id, t);
    }
  }
  // Raise a new army when rich and allowed.
  const home = f === 'drift' ? KITE_FIELDS : ownedRegions(s, f).find((r) => regionDef(r).major) ?? ownedRegions(s, f)[0];
  if (home && fs.coin > 2000 && canRaiseArmy(s, f, home).ok) {
    const r = raiseArmy(s, f, home);
    if (r.ok) recruitAll(s, f);
  }
}

function weightedPick(s: CampaignState, f: FactionId, a: ArmyState, ids: string[]): string | null {
  const w = DOCTRINE_ROLES[f];
  let best: string | null = null;
  let bestScore = -Infinity;
  const count = (role: string) => a.units.filter((u) => unitDef(u.def).role === role).length;
  const total = a.units.length + 1;
  for (const id of ids) {
    const d = unitDef(id);
    const weight = w[d.role] ?? 0.5;
    // Aim for the doctrine's share of each role, prefer higher tiers, avoid duplicates.
    const want = (weight / 14) * (total + 1);
    const have = count(d.role);
    const dup = a.units.filter((u) => u.def === id).length;
    const score = (want - have) * 3 + d.tier * 0.6 - dup * 0.8 + (d.category === 'colossus' ? 4 : 0) + hashNoise(s.turn, id);
    if (score > bestScore) {
      bestScore = score;
      best = id;
    }
  }
  return best;
}

function hashNoise(t: number, id: string): number {
  let h = t * 2654435761;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return ((h >>> 0) % 1000) / 1000;
}

// ----------------------------------------------------------------- military

interface Target {
  region: string;
  value: number;
  need: number;
}

function targetsFor(s: CampaignState, f: FactionId): Target[] {
  const out: Target[] = [];
  for (const r of REGIONS) {
    const st = s.regions[r.id]!;
    const enemies = s.armies.filter((a) => a.region === r.id && a.faction !== f && hostile(s, f, a.faction));
    const settlementHostile = !!r.settlement && st.owner !== f && hostile(s, f, st.owner);
    if (!enemies.length && !settlementHostile) continue;
    // Don't start wars by accident with peaceful factions' land.
    if (st.owner !== 'free' && st.owner !== f && !atWar(s, f, st.owner) && !enemies.length) continue;
    let value = 1;
    if (r.settlement) value += r.major ? 3 : 1.5;
    if (r.landmark === 'candle') value += f === 'choir' || f === 'hush' ? 4 : 0.5;
    if (r.id === NAIL_SPIRE) value += f === 'choir' || f === 'hush' ? 3 : 0;
    if (f === 'vesperate' && bandIndex(s, r.id) === 2) value += 2;
    if (f === 'drift' && st.owner === 'free' && !st.mooring) value += 1;
    if (f === 'drift' && r.id === KITE_FIELDS) value += 5;
    // Stay in bands we can live in.
    const band = bandIndex(s, r.id);
    if (f !== 'hush' && band === 0) value -= 1.5;
    if (f !== 'choir' && band === 4) value -= 1.5;
    if (f === 'hush' && band >= 3) value -= 1;
    let need = enemies.reduce((t, e) => t + armyPower(e), 0);
    if (settlementHostile) need += garrisonPower(s, r.id);
    out.push({ region: r.id, value, need });
  }
  return out;
}

function military(s: CampaignState, f: FactionId): PendingBattle[] {
  const battles: PendingBattle[] = [];
  const claimed = new Set<string>();
  const armies = factionArmies(s, f).sort((a, b) => armyPower(b) - armyPower(a));
  const targets = targetsFor(s, f);
  for (const a of armies) {
    if (a.moves <= 0 || a.fought) continue;
    const power = armyPower(a);
    // Already standing in a hostile settlement's land: assault or raid.
    if (hostileSettlement(s, a.region, f)) {
      const need = garrisonPower(s, a.region);
      if (power > need * 1.25) {
        const r = assault(s, a.id);
        if (r.ok) {
          battles.push(r.battle);
          claimed.add(a.region);
          continue;
        }
      } else {
        setStance(s, a.id, 'raid');
        continue;
      }
    }
    // Defend home: enemies next to our settlements.
    const threat = ownedRegions(s, f).find((id) => neighbors(id).some((n) => hostileArmiesIn(s, n, f).some((e) => armyPower(e) > 1500)) && !s.armies.some((x) => x.faction === f && x.region === id));
    if (threat && power < 9000 && f !== 'drift') {
      const path = findPath(s, a, threat);
      if (path && path.length <= 2) {
        moveArmy(s, a.id, threat);
        continue;
      }
    }
    // Refill when weak.
    const strength = a.units.reduce((t, u) => t + u.strength, 0) / Math.max(1, a.units.length);
    if (a.units.length < 4 || strength < 0.55) {
      retreatHome(s, a);
      continue;
    }
    const reach = reachable(s, a);
    const steps = stepsFrom(a.region);
    let best: { t: Target; score: number } | null = null;
    for (const t of targets) {
      if (claimed.has(t.region)) continue;
      const dist = steps[t.region] ?? 99;
      if (dist > 6) continue;
      const ratio = power / Math.max(1, t.need);
      const burned = s.reports.some((r) => r.turn >= s.turn - 3 && r.region === t.region && r.attacker === f && r.winner !== f);
      if (ratio < (burned ? 2 : 1.25)) continue;
      const sun = sunForAttacker(a.region, t.region);
      const sunBonus = sun === 'back' ? 0.4 : sun === 'eyes' ? -0.3 : 0;
      const score = t.value * Math.min(2, ratio) - dist * 0.8 + sunBonus + (a.crusade?.target === t.region ? 5 : 0);
      if (!best || score > best.score) best = { t, score };
    }
    if (!best) {
      if (f === 'drift') driftWander(s, a);
      continue;
    }
    claimed.add(best.t.region);
    const res = moveArmy(s, a.id, best.t.region);
    if (!res.ok) continue;
    if (res.battle) battles.push(res.battle);
    else if (res.atSettlement === best.t.region) {
      const r = assault(s, a.id);
      if (r.ok) battles.push(r.battle);
    }
    void reach;
  }
  return battles;
}

function retreatHome(s: CampaignState, a: ArmyState): void {
  const f = a.faction;
  if (f === 'drift') {
    // Wind-cities heal anywhere friendly; head for the Gale Roads.
    if (regionStance(s, a) === 'hostile') driftWander(s, a);
    return;
  }
  const own = ownedRegions(s, f);
  if (own.includes(a.region)) return;
  const steps = stepsFrom(a.region);
  own.sort((x, y) => (steps[x] ?? 99) - (steps[y] ?? 99));
  if (own[0]) moveArmy(s, a.id, own[0]);
}

function driftWander(s: CampaignState, a: ArmyState): void {
  // Migrate: visit bands not yet seen on this migration, along the Gale Roads.
  const seen = new Set(a.bandsVisited ?? []);
  const reach = reachable(s, a);
  let best: string | null = null;
  let bestScore = -Infinity;
  for (const id in reach) {
    const r = regionDef(id);
    if (hostileArmiesIn(s, id, 'drift').length) continue;
    if (hostileSettlement(s, id, 'drift') && !s.regions[id]!.mooring) continue;
    const b = bandIndex(s, id);
    const score = (seen.has(b) ? 0 : 3) + (r.galeRoad ? 1.5 : 0) + (s.regions[id]!.mooring ? 1 : 0) - reach[id]! / 100;
    if (score > bestScore) {
      bestScore = score;
      best = id;
    }
  }
  if (best) moveArmy(s, a.id, best);
}

// ----------------------------------------------------------- faction moves

function mechanics(s: CampaignState, f: FactionId): void {
  const fs = s.factions[f];
  if (f === 'choir') {
    if (!fs.hymn && fs.res >= 250) {
      const atWarAny = FACTION_IDS.some((o) => o !== f && atWar(s, f, o));
      singHymn(s, fs.food < 10 ? 'harvest' : atWarAny ? 'noon' : 'harvest');
    }
    for (const c of [...CANDLES, NAIL_SPIRE]) {
      const r = s.regions[c]!;
      if (r.owner !== 'choir') continue;
      if (CANDLES.includes(c) && !r.lit) relight(s, c);
      if (fs.res >= 220) pilgrimage(s, c);
    }
    if (lensReady(s).ok) buildLensStage(s);
    if (fs.zeal >= 60 && !s.armies.some((a) => a.crusade)) {
      const army = factionArmies(s, f).sort((a, b) => armyPower(b) - armyPower(a))[0];
      const target = CANDLES.find((c) => s.regions[c]!.owner !== 'choir') ?? ownedRegions(s, 'hush')[0];
      if (army && target) crusade(s, army.id, target);
    }
  }
  if (f === 'hush') {
    for (const c of CANDLES) if (s.regions[c]!.owner === 'hush' && s.regions[c]!.lit) extinguish(s, c);
    for (const r of [POLE, ...CANDLES]) if (s.regions[r]!.owner === 'hush' && fs.coin > 900) listen(s, r);
  }
  if (f === 'vesperate') {
    if ((Math.abs(s.tilt) >= 2 || (Math.abs(s.tilt) === 1 && fs.coin > 4000)) && fs.coin > 1800) greatToll(s);
    // Keep the Houses content.
    for (const h of ['carillon', 'lantern', 'weir'] as const) {
      if (fs.houses[h] < 30 && fs.coin > 800) {
        fs.coin -= 200;
        fs.houses[h] = Math.min(100, fs.houses[h] + 10);
      }
    }
  }
  if (f === 'drift') {
    for (const a of factionArmies(s, f)) {
      if (s.regions[a.region]!.owner === 'free' && regionDef(a.region).settlement && !s.regions[a.region]!.mooring) {
        demandTribute(s, a.id, armyPower, (r) => garrisonPower(s, r));
      }
    }
  }
}

function afterBattles(s: CampaignState, f: FactionId): void {
  if (f === 'hush') for (const c of CANDLES) if (s.regions[c]!.owner === 'hush' && s.regions[c]!.lit) extinguish(s, c);
}

// --------------------------------------------------------------- diplomacy

function diplomacy(s: CampaignState, f: FactionId): void {
  const me = factionStrength(s, f);
  for (const o of FACTION_IDS) {
    if (o === f || !s.factions[o].alive) continue;
    const rel = relation(s, f, o);
    const them = factionStrength(s, o);
    if (rel.stance === 'war') {
      // Sue for peace when losing badly and the war is old.
      if (them > me * 1.6 && s.turn - rel.since > 6 && !s.factions[o].player) propose(s, { kind: 'peace', from: f, to: o });
      continue;
    }
    // Opportunistic wars on weaker neighbors, rarely, and never early.
    const borders = ownedRegions(s, o).some((r) => neighbors(r).some((n) => s.regions[n]!.owner === f));
    const eager = { choir: 1.3, hush: 1.4, vesperate: 1.9, drift: 1.5 }[f];
    if (s.turn > 12 && borders && me > them * eager && rel.opinion < 10 && s.turn - rel.since > 10 && rel.stance === 'peace') {
      if (hashNoise(s.turn, f + o) < 0.15) declareWar(s, f, o);
      continue;
    }
    if (!rel.trade && rel.opinion > -20 && !s.factions[o].player) propose(s, { kind: 'trade', from: f, to: o });
    // Everyone gangs up on a faction in its final victory stage.
    if (s.factions[o].finalStage && rel.stance === 'peace' && s.turn - rel.since > 3) declareWar(s, f, o);
  }
}

export function aiPreviewTargets(s: CampaignState, f: FactionId): string[] {
  return targetsFor(s, f).map((t) => t.region);
}

export { attackerPower, defenderPower, chainLevel, factionChains };
