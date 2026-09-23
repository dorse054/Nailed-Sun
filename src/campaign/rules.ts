/**
 * Campaign rules: light bands under the Tilt, the economy (coin, food,
 * public order and faction resources), upkeep, replenishment, attrition and
 * movement. Pure functions of the state, so the UI can preview every number.
 */
import type { BandId, FactionId, LightLevel, UnitDef, WindLevel } from '../data/schema';
import { BAND_IDS } from '../data/schema';
import { unitDef } from '../data/index';
import { clamp } from '../core/dmath';
import type { ArmyState, CampaignState, CampaignUnit, RegionState } from './types';
import { REGIONS, RESOURCES, regionDef } from './regions';
import { chainDef, type BuildingEffects } from './buildings';
import { neighbors } from './geometry';
import { allied, armiesIn, hostile, relation } from './state';
import { FACTION_IDS } from '../data/schema';

// ------------------------------------------------------------------ light

/** Band index 0 (Evernight) .. 4 (Glare) of a region under the current Tilt. */
export function bandIndex(s: CampaignState, id: string): number {
  const r = regionDef(id);
  let b = clamp(Math.floor(r.h + s.tilt * 0.2), 0, 4);
  if (s.regions[id]?.nightfall) b = Math.max(0, b - 2);
  return b;
}

export function regionBand(s: CampaignState, id: string): BandId {
  return BAND_IDS[bandIndex(s, id)]!;
}

/** Sun-height inside the band, 0..1: how close the region is to flipping. */
export function bandPosition(s: CampaignState, id: string): number {
  const h = regionDef(id).h + s.tilt * 0.2;
  return h - Math.floor(h);
}

export function regionLight(s: CampaignState, id: string): LightLevel {
  return bandIndex(s, id) as LightLevel;
}

/** Storm-riders: every 2 points of Tilt raise the wind one step everywhere. */
export function regionWind(s: CampaignState, id: string): WindLevel {
  if (s.shudder.stillness > 0) return 0;
  const base = regionDef(id).wind;
  return clamp(base + Math.floor(Math.abs(s.tilt) / 2), 0, 2) as WindLevel;
}

// ------------------------------------------------------------- buildings

export function regionEffects(r: RegionState): BuildingEffects[] {
  const out: BuildingEffects[] = [];
  for (const sl of r.slots) {
    if (!sl || sl.level <= 0) continue;
    const c = chainDef(sl.chain);
    out.push(c.effects[sl.level - 1]!);
  }
  return out;
}

export function sumEffect(effects: BuildingEffects[], key: keyof BuildingEffects): number {
  let t = 0;
  for (const e of effects) {
    const v = e[key];
    if (typeof v === 'number') t += v;
  }
  return t;
}

export function hasEffect(effects: BuildingEffects[], key: keyof BuildingEffects): boolean {
  return effects.some((e) => !!e[key]);
}

export function chainLevel(r: { slots: RegionState['slots'] }, kind: string): number {
  let best = 0;
  for (const sl of r.slots) {
    if (!sl) continue;
    if (chainDef(sl.chain).kind === kind) best = Math.max(best, sl.level);
  }
  return best;
}

export function wallLevel(s: CampaignState, id: string): number {
  const r = s.regions[id]!;
  let w = sumEffect(regionEffects(r), 'walls');
  // Candles and the Spire have old monastery walls even when free.
  const def = regionDef(id);
  if (r.owner === 'free' && (def.landmark === 'candle' || def.landmark === 'nailSpire') && w === 0) w = 1;
  return w;
}

export function maxLevel(id: string): number {
  return regionDef(id).major ? 4 : 3;
}

export function slotCount(id: string, level: number): number {
  return regionDef(id).major ? [3, 4, 5, 6][level - 1]! : [2, 3, 3][level - 1]!;
}

export const GROWTH_NEEDED = [0, 6, 12, 20];
export const LEVEL_COST = [0, 400, 900, 1800];

// ---------------------------------------------------------------- economy

const MAJOR_COIN = [0, 200, 280, 380, 500];
const MINOR_COIN = [0, 110, 160, 220];
const BAND_FOOD = [0, 1, 4, 2, 0];
const FARM_MULT = [0.25, 0.6, 1.3, 1, 0.25];
const DIFFICULTY_AI = { easy: 0.85, normal: 1, hard: 1.25 } as const;

export interface RegionYield {
  coin: number;
  food: number;
  res: number;
  lines: { label: string; coin?: number; food?: number; res?: number }[];
}

export function currentObservance(s: CampaignState): string | null {
  const v = s.factions.vesperate;
  if (!v.alive || v.lapsed === s.turn) return null;
  return v.calendar[s.turn % v.calendar.length] ?? null;
}

export function herdIn(s: CampaignState, id: string): number {
  let n = 0;
  for (const h of s.factions.hush.herds) if (h.region === id) n += h.size;
  return n;
}

/** What one region yields its owner this Toll. */
export function regionYield(s: CampaignState, id: string): RegionYield {
  const r = s.regions[id]!;
  const def = regionDef(id);
  const out: RegionYield = { coin: 0, food: 0, res: 0, lines: [] };
  if (r.owner === 'free' || !def.settlement) return out;
  const f = r.owner;
  const fs = s.factions[f];
  const band = bandIndex(s, id);
  const eff = regionEffects(r);
  // Coin.
  let coin = (def.major ? MAJOR_COIN : MINOR_COIN)[r.level] ?? 0;
  coin += RESOURCES[def.resource].coin;
  coin += sumEffect(eff, 'coin');
  if (r.order < 0) coin *= 1 + r.order / 40;
  if (f === 'vesperate' && currentObservance(s) === 'market') coin *= 1.2;
  if (!fs.player) coin *= DIFFICULTY_AI[s.difficulty];
  if (r.raidedBy) coin = 0;
  out.coin = Math.round(coin);
  // Food.
  let food = f === 'hush' ? 0 : BAND_FOOD[band]!;
  const farm = sumEffect(eff, 'food');
  const farmKind = eff.length ? farm : 0;
  food += f === 'hush' ? farmKind : farmKind * FARM_MULT[band]!;
  food += RESOURCES[def.resource].food ?? 0;
  if (f === 'hush') {
    const herd = herdIn(s, id);
    if (herd > 0) food += herd * (2 + sumEffect(eff, 'herdFood'));
  }
  if (f === 'vesperate' && currentObservance(s) === 'harvest') food *= 1.25;
  if (f === 'choir' && fs.hymn?.id === 'harvest') food *= 1.3;
  food -= r.level;
  out.food = Math.round(food * 10) / 10;
  // Faction resource.
  let res = sumEffect(eff, 'res');
  if (f === 'choir') {
    // Radiance: sunlit land. Mirror towers fail in Dim and Dark unless on a Candle.
    res += [0, 0, 1, 2, 3][band]!;
    const tower = eff.find((e) => e.vision);
    if (tower && band <= 1 && def.landmark !== 'candle') res -= tower.res ?? 0;
  }
  if (f === 'vesperate' && id === 'vesper') res += 2;
  out.res = res;
  return out;
}

export function armyFood(s: CampaignState, a: ArmyState): number {
  const n = a.units.length + 1;
  let eat = n * 0.5;
  if (a.faction === 'hush' && herdIn(s, a.region) > 0) eat = 0;
  if (a.faction === 'drift') {
    // The steppe and the moorings feed a wind-city; elsewhere it lives on stores.
    if (regionDef(a.region).galeRoad || s.regions[a.region]!.mooring) eat = 0;
    else if (s.regions[a.region]!.owner === 'free' && !regionDef(a.region).settlement) eat *= 0.5;
    if (a.city) eat -= sumEffect(cityEffects(a), 'food');
  }
  return eat;
}

export function cityEffects(a: ArmyState): BuildingEffects[] {
  if (!a.city) return [];
  return regionEffects({ slots: a.city.slots } as RegionState);
}

// ----------------------------------------------------------------- upkeep

export const UPKEEP_RATE = 0.05;

/** Each extra copy of a unit adds 5% upkeep to every copy. */
export function armyUpkeep(a: ArmyState): number {
  const counts = new Map<string, number>();
  for (const u of a.units) counts.set(u.def, (counts.get(u.def) ?? 0) + 1);
  let t = unitDef(a.lord.def).cost * UPKEEP_RATE;
  for (const u of a.units) {
    const d = unitDef(u.def);
    if (d.category === 'colossus') {
      t += d.cost * 0.04;
      continue;
    }
    t += d.cost * UPKEEP_RATE * (1 + 0.05 * ((counts.get(u.def) ?? 1) - 1));
  }
  if (a.crusade) t *= 0.7;
  return Math.round(t);
}

export function duplicatePenalty(a: ArmyState, def: string): number {
  const n = a.units.filter((u) => u.def === def).length;
  return n * 5;
}

// ------------------------------------------------------------ public order

export interface OrderLine {
  label: string;
  value: number;
}

export function orderLines(s: CampaignState, id: string): OrderLine[] {
  const r = s.regions[id]!;
  if (r.owner === 'free') return [];
  const f = r.owner;
  const lines: OrderLine[] = [];
  const add = (label: string, value: number) => {
    if (value) lines.push({ label, value: Math.round(value * 10) / 10 });
  };
  add('Settled land', 1);
  add('Buildings', sumEffect(regionEffects(r), 'order'));
  add('City size', -(r.level - 1));
  if (armiesIn(s, id, f).length > 0) add('Garrisoned army', 2);
  const since = s.turn - r.takenTurn;
  if (since < 8) add('Recently conquered', -Math.ceil((8 - since) / 3));
  if (r.culture !== f) add('Foreign people', -1);
  if (f !== 'hush' && s.factions.hush.alive && s.factions.hush.res >= 50) {
    const near = neighbors(id).some((n) => s.regions[n]!.owner === 'hush' || armiesIn(s, n, 'hush').length > 0) || armiesIn(s, id, 'hush').length > 0;
    if (near) add('Hush Dread', -3);
  }
  if (s.factions[f].food < 0) add('Starvation', -3);
  if (f === 'vesperate' && currentObservance(s) === 'vigil') add('Vigil observance', 4);
  if (f === 'vesperate') {
    const h = s.factions.vesperate.houses;
    const worst = Math.min(h.carillon, h.lantern, h.weir);
    if (worst < 25) add('A House is restless', -2);
  }
  if (f === 'choir' && s.factions.choir.zeal >= 50) add('Zeal', 1);
  if (r.raidedBy) add('Raided', -3);
  const band = bandIndex(s, id);
  if (f === 'choir' && band <= 1) add('Dark land', -1);
  if (f === 'hush' && band >= 3) add('Bright land', -1);
  if (!s.factions[f].player && s.difficulty === 'hard') add('Hard campaign', 1);
  return lines;
}

export function orderDelta(s: CampaignState, id: string): number {
  return orderLines(s, id).reduce((t, l) => t + l.value, 0);
}

// ------------------------------------------------------- armies in the world

export function regionStance(s: CampaignState, a: ArmyState): 'own' | 'allied' | 'neutral' | 'hostile' {
  const o = s.regions[a.region]!.owner;
  if (o === a.faction) return 'own';
  if (o === 'free') {
    if (a.faction === 'drift' && s.regions[a.region]!.mooring) return 'allied';
    return regionDef(a.region).settlement ? 'hostile' : 'neutral';
  }
  if (allied(s, a.faction, o)) return 'allied';
  if (relation(s, a.faction, o).stance === 'war') return 'hostile';
  return 'neutral';
}

export function heliographReach(s: CampaignState, f: FactionId): Set<string> {
  const seen = new Set<string>();
  if (f !== 'choir') return seen;
  for (const r of REGIONS) {
    const st = s.regions[r.id]!;
    if (st.owner !== 'choir') continue;
    const v = Math.max(0, ...regionEffects(st).map((e) => e.vision ?? 0));
    if (v <= 0) continue;
    if (bandIndex(s, r.id) <= 1 && r.landmark !== 'candle') continue;
    const dist: Record<string, number> = { [r.id]: 0 };
    const q = [r.id];
    while (q.length) {
      const c = q.shift()!;
      seen.add(c);
      if (dist[c]! >= v) continue;
      for (const n of neighbors(c)) {
        if (dist[n] !== undefined) continue;
        dist[n] = dist[c]! + 1;
        q.push(n);
      }
    }
  }
  return seen;
}

/** Replenishment in % of full strength per Toll. */
export function replenishRate(s: CampaignState, a: ArmyState): number {
  const st = regionStance(s, a);
  if (a.fought) return 0;
  let r = st === 'own' ? 10 : st === 'allied' ? 7 : st === 'neutral' ? 4 : 0;
  if (a.faction === 'drift' && st !== 'hostile') r = Math.max(r, 7);
  if (st === 'own') r += sumEffect(regionEffects(s.regions[a.region]!), 'replenish');
  if (a.faction === 'choir' && st !== 'hostile' && heliographReach(s, 'choir').has(a.region)) r += 3;
  if (a.faction === 'hush' && herdIn(s, a.region) > 0) r += 3;
  if (a.faction === 'choir' && bandIndex(s, a.region) <= 1 && !a.lord.traits.includes('lampBearer')) r *= 0.5;
  return r;
}

/** Attrition in % strength lost per Toll, with the reason. */
export function attrition(s: CampaignState, a: ArmyState): { pct: number; why: string } {
  const band = bandIndex(s, a.region);
  const def = regionDef(a.region);
  const t = a.lord.traits;
  let pct = 0;
  let why = '';
  if (a.faction === 'drift' && def.galeRoad) return { pct: 0, why: '' };
  if (band === 4 && a.faction !== 'choir') {
    pct = 8;
    why = 'The Glare burns';
  }
  if (band === 0 && a.faction !== 'hush') {
    pct = 8;
    why = 'The Evernight freezes';
  }
  if (a.faction === 'hush' && band >= 3) {
    pct = t.includes('veil') ? 0 : band === 4 ? 10 : 6;
    why = pct ? 'The light burns the Hush' : '';
  }
  if (pct && (t.includes('provisioned') || t.includes('stormCloaks') || (a.faction === 'choir' && t.includes('lampBearer')))) pct /= 2;
  if (s.factions[a.faction].food < 0) {
    pct += 5;
    why = why ? `${why}; starving` : 'Starving';
  }
  return { pct, why };
}

/** Army-wide leadership modifiers for a battle in this region. */
export function battleLeadership(s: CampaignState, a: ArmyState | null, faction: FactionId, enemy: FactionId | 'free', region: string): { pct: number; why: string[] } {
  let pct = 0;
  const why: string[] = [];
  const band = bandIndex(s, region);
  if (faction === 'choir' && band <= 1 && !(a && a.lord.traits.includes('lampBearer'))) {
    pct -= 10;
    why.push('Choir in the dark −10%');
  }
  if (faction === 'vesperate') {
    const st = s.regions[region]!;
    if (st.owner === 'vesperate' && regionEffects(st).some((e) => e.bellRange)) {
      pct += 10;
      why.push('Bell Range +10%');
    }
  }
  if (enemy === 'hush' && faction !== 'hush' && s.factions.hush.res >= 50) {
    pct -= 10;
    why.push('Hush Dread −10%');
  }
  if (enemy !== 'free' && s.factions[enemy].finalStage && faction !== enemy) {
    pct += 15;
    why.push('Coalition against the leader +15%');
  }
  if (faction === 'choir' && s.factions.choir.hymn?.id === 'unbowed') {
    pct += 10;
    why.push('Hymn of the Unbowed +10%');
  }
  return { pct, why };
}

// ---------------------------------------------------------------- movement

export const FULL_MOVES = 100;
export const STEP = 50;

export function maxMoves(a: ArmyState): number {
  let m = FULL_MOVES;
  if (a.city) m += sumEffect(cityEffects(a), 'moves');
  return m;
}

export function canalsFor(s: CampaignState, f: FactionId): boolean {
  if (f !== 'vesperate') return false;
  return REGIONS.some((r) => s.regions[r.id]!.owner === 'vesperate' && regionEffects(s.regions[r.id]!).some((e) => e.canal));
}

/** Cost to move one step, or Infinity if the move is not allowed. */
export function stepCost(s: CampaignState, a: ArmyState, from: string, to: string): number {
  if (!neighbors(from).includes(to)) return Infinity;
  let c = STEP;
  const df = regionDef(from);
  const dt = regionDef(to);
  if (a.faction === 'drift') {
    if (df.galeRoad && dt.galeRoad) c = STEP / 1.5;
    else if (dt.h > df.h + 0.25) c = STEP / 1.5;
    else if (dt.h < df.h - 0.25) c = STEP / 0.7;
  }
  if (a.faction === 'vesperate' && df.river && dt.river && canalsFor(s, 'vesperate')) c = STEP / 1.5;
  return Math.round(c);
}

export interface PathStep {
  region: string;
  cost: number;
}

/**
 * Cheapest path by movement points. Armies stop when they enter a region
 * with an enemy army or a hostile settlement: that ends the march in battle.
 */
export function findPath(s: CampaignState, a: ArmyState, to: string, maxCost = Infinity): PathStep[] | null {
  const dist: Record<string, number> = { [a.region]: 0 };
  const prev: Record<string, string> = {};
  const open = [a.region];
  while (open.length) {
    open.sort((x, y) => dist[x]! - dist[y]!);
    const c = open.shift()!;
    if (c === to) break;
    if (c !== a.region && blocksPath(s, a, c)) continue;
    for (const n of neighbors(c)) {
      const step = stepCost(s, a, c, n);
      const nd = dist[c]! + step;
      if (nd > maxCost) continue;
      if (dist[n] === undefined || nd < dist[n]!) {
        dist[n] = nd;
        prev[n] = c;
        if (!open.includes(n)) open.push(n);
      }
    }
  }
  if (dist[to] === undefined) return null;
  const path: PathStep[] = [];
  let c = to;
  while (c !== a.region) {
    path.unshift({ region: c, cost: dist[c]! });
    c = prev[c]!;
  }
  return path;
}

/** Enemy armies or a hostile settlement stop a march. */
export function blocksPath(s: CampaignState, a: ArmyState, region: string): boolean {
  if (s.armies.some((o) => o.region === region && o.faction !== a.faction && hostile(s, a.faction, o.faction) && o.units.length + 1 > 0)) return true;
  const r = s.regions[region]!;
  if (!regionDef(region).settlement) return false;
  if (r.owner === a.faction) return false;
  if (r.owner === 'free') return !(a.faction === 'drift' && r.mooring);
  return hostile(s, a.faction, r.owner);
}

/** Regions an army can reach this Toll, with their costs. */
export function reachable(s: CampaignState, a: ArmyState): Record<string, number> {
  const out: Record<string, number> = {};
  const dist: Record<string, number> = { [a.region]: 0 };
  const open = [a.region];
  while (open.length) {
    open.sort((x, y) => dist[x]! - dist[y]!);
    const c = open.shift()!;
    if (c !== a.region) out[c] = dist[c]!;
    if (c !== a.region && blocksPath(s, a, c)) continue;
    for (const n of neighbors(c)) {
      const nd = dist[c]! + stepCost(s, a, c, n);
      if (nd > a.moves) continue;
      if (dist[n] === undefined || nd < dist[n]!) {
        dist[n] = nd;
        if (!open.includes(n)) open.push(n);
      }
    }
  }
  // Shadow Roads: from one Umbral Vale to any other in a single march.
  if (a.faction === 'hush' && regionDef(a.region).vale && a.moves >= STEP) {
    for (const r of REGIONS) if (r.vale && r.id !== a.region && out[r.id] === undefined) out[r.id] = a.moves;
  }
  return out;
}

// ------------------------------------------------------------ recruitment

export function unitCost(s: CampaignState, f: FactionId, d: UnitDef, region: string | null): { coin: number; res: number } {
  let coin = d.cost;
  let res = 0;
  if (f === 'vesperate' && currentObservance(s) === 'muster') coin *= 0.75;
  if (region) {
    const st = s.regions[region];
    if (st && st.owner === f) coin *= 1 - sumEffect(regionEffects(st), 'recruitPct') / 100;
  }
  if (f === 'choir' && (d.missile?.lightScaled || d.missile?.trajectory === 'beam' || d.missile?.trajectory === 'lineBeam')) res += 50;
  if (d.category === 'colossus') {
    if (f === 'choir') res += 300;
    if (f === 'vesperate') res += 80;
    if (f === 'hush') res += 60;
    if (f === 'drift') res += 150;
  }
  return { coin: Math.round(coin), res };
}

export function strengthOf(u: CampaignUnit): number {
  return unitDef(u.def).cost * u.strength * (1 + u.rank * 0.08);
}

/** Rough fighting value of an army for the AI and the battle forecast. */
export function armyPower(a: ArmyState): number {
  let p = unitDef(a.lord.def).cost * 0.8;
  for (const u of a.units) p += strengthOf(u);
  return p;
}

export function factionIncomePreview(s: CampaignState, f: FactionId): { coin: number; food: number; res: number } {
  let coin = 0;
  let food = 0;
  let res = 0;
  for (const r of REGIONS) {
    if (s.regions[r.id]!.owner !== f) continue;
    const y = regionYield(s, r.id);
    coin += y.coin;
    food += y.food;
    res += y.res;
  }
  for (const a of s.armies) {
    if (a.faction !== f) continue;
    coin -= armyUpkeep(a);
    food -= armyFood(s, a);
    if (a.city) {
      coin += sumEffect(cityEffects(a), 'coin');
      res += sumEffect(cityEffects(a), 'res');
    }
  }
  return { coin, food, res };
}

export function allFactions(): FactionId[] {
  return [...FACTION_IDS];
}
