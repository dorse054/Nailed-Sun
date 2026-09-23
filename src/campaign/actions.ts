/**
 * Everything a faction can do in its Toll. The player's UI and the AI call
 * the same functions, and every one validates before it changes anything.
 */
import type { FactionId, UnitDef } from '../data/schema';
import { factionDef, recruitable, unitDef } from '../data/index';
import type { ArmyState, ArmyStance, BuildingSlot, CampaignState, HouseId, HymnId, ObservanceId, PendingBattle } from './types';
import { chainDef, factionChains, recruitRequirement, type ChainDef } from './buildings';
import { CANDLES, NAIL_SPIRE, POLE, REGIONS, regionDef } from './regions';
import { neighbors } from './geometry';
import { armiesIn, armyById, factionArmies, hostile, log, nextId, ownedRegions, relation } from './state';
import {
  GROWTH_NEEDED,
  LEVEL_COST,
  STEP,
  bandIndex,
  chainLevel,
  cityEffects,
  findPath,
  maxLevel,
  maxMoves,
  regionStance,
  slotCount,
  stepCost,
  sumEffect,
  unitCost,
} from './rules';
import { armyName, capitalOf } from './setup';
import { lordName } from './names';

export type Result<T = object> = ({ ok: true } & T) | { ok: false; reason: string };

const fail = (reason: string): { ok: false; reason: string } => ({ ok: false, reason });

export const MAX_UNITS = 16;

// ---------------------------------------------------------------- movement

export interface MoveResult {
  /** A battle the move started: enemy armies stood in the way. */
  battle?: PendingBattle;
  /** The army stopped in a hostile settlement's region: assault or raid. */
  atSettlement?: string;
  path: string[];
}

export function hostileArmiesIn(s: CampaignState, region: string, f: FactionId): ArmyState[] {
  return s.armies.filter((o) => o.region === region && o.faction !== f && hostile(s, f, o.faction));
}

export function hostileSettlement(s: CampaignState, region: string, f: FactionId): boolean {
  if (!regionDef(region).settlement) return false;
  const r = s.regions[region]!;
  // A free city with a Drift mooring is a friendly port to the Drift.
  if (f === 'drift' && r.owner === 'free' && r.mooring) return false;
  return r.owner !== f && hostile(s, f, r.owner);
}

/**
 * March toward a region, as far as this Toll's movement allows. The march
 * stops at the first region with enemy armies (a battle) or a hostile
 * settlement (the army can then assault it or raid the countryside).
 */
export function moveArmy(s: CampaignState, armyId: string, to: string): Result<MoveResult> {
  const a = armyById(s, armyId);
  if (!a) return fail('No such army');
  if (a.region === to) return fail('Already there');
  if (a.moves <= 0) return fail('No movement left this Toll');
  // Shadow Roads: vale to vale in one march.
  const def = regionDef(a.region);
  if (a.faction === 'hush' && def.vale && regionDef(to).vale && !neighbors(a.region).includes(to)) {
    if (a.moves < STEP) return fail('Needs half a Toll of movement to take the Shadow Roads');
    return arrive(s, a, a.region, to, a.moves, true);
  }
  const path = findPath(s, a, to);
  if (!path) return fail('No route');
  let prev = a.region;
  const walked: string[] = [];
  for (const step of path) {
    const cost = stepCost(s, a, prev, step.region);
    // arrive() spends each step's cost from a.moves as the army walks.
    if (cost > a.moves + 0.001) break;
    const r = arrive(s, a, prev, step.region, cost, false);
    if (!r.ok) return r;
    walked.push(step.region);
    if (r.battle || r.atSettlement) return { ok: true, battle: r.battle, atSettlement: r.atSettlement, path: walked };
    prev = step.region;
  }
  if (walked.length === 0) return fail('Not enough movement for the first step');
  return { ok: true, path: walked };
}

function arrive(s: CampaignState, a: ArmyState, from: string, to: string, cost: number, shadow: boolean): Result<MoveResult> {
  const enemies = hostileArmiesIn(s, to, a.faction);
  if (enemies.length) {
    // The attacker waits at the border until the battle is decided.
    a.moves = 0;
    const b = makeBattle(s, a, from, to);
    return { ok: true, battle: b, path: [] };
  }
  a.moves = Math.max(0, a.moves - cost);
  if (shadow) a.moves = 0;
  a.from = from;
  a.region = to;
  a.shadowed = shadow || (a.shadowed && a.faction === 'hush' && regionDef(to).vale) || false;
  if (a.faction === 'drift') {
    const b = bandIndex(s, to);
    a.bandsVisited = a.bandsVisited ?? [];
    if (!a.bandsVisited.includes(b)) a.bandsVisited.push(b);
  }
  // Trespassing on a peaceful faction's land costs goodwill.
  const owner = s.regions[to]!.owner;
  if (owner !== 'free' && owner !== a.faction && relation(s, a.faction, owner).stance === 'peace') {
    relation(s, a.faction, owner).opinion -= 2;
  }
  if (hostileSettlement(s, to, a.faction)) {
    a.moves = 0;
    return { ok: true, atSettlement: to, path: [to] };
  }
  return { ok: true, path: [to] };
}

export function makeBattle(s: CampaignState, a: ArmyState, from: string, to: string): PendingBattle {
  const enemies = hostileArmiesIn(s, to, a.faction);
  const r = s.regions[to]!;
  const defFaction = enemies.length ? enemies[0]!.faction : r.owner;
  const defArmies = enemies.filter((e) => e.faction === defFaction).map((e) => e.id);
  const garrison = !!regionDef(to).settlement && r.owner === defFaction && r.owner !== a.faction;
  a.shadowed = false;
  a.fought = true;
  return {
    id: nextId(s, 'b'),
    attacker: { faction: a.faction, armies: [a.id] },
    defender: { faction: defFaction, armies: defArmies, garrison },
    region: to,
    from,
    assault: garrison,
  };
}

/** Assault the settlement of the region the army stands in. */
export function assault(s: CampaignState, armyId: string): Result<{ battle: PendingBattle }> {
  const a = armyById(s, armyId);
  if (!a) return fail('No such army');
  if (!hostileSettlement(s, a.region, a.faction)) return fail('No hostile settlement here');
  if (a.fought) return fail('This army has already fought this Toll');
  const b = makeBattle(s, a, a.from ?? neighbors(a.region)[0]!, a.region);
  b.assault = true;
  return { ok: true, battle: b };
}

export function setStance(s: CampaignState, armyId: string, stance: ArmyStance): Result {
  const a = armyById(s, armyId);
  if (!a) return fail('No such army');
  if (stance === 'raid') {
    const st = regionStance(s, a);
    if (st !== 'hostile') return fail('Raid only in hostile land');
  }
  a.stance = stance;
  return { ok: true };
}

// ------------------------------------------------------------- recruitment

export interface RecruitOption {
  def: UnitDef;
  coin: number;
  res: number;
  ok: boolean;
  reason?: string;
}

/** Where an army can recruit: its own settlement, or a Drift wind-city in friendly land. */
/** Buildings that train troops (see recruitRequirement). */
const RECRUIT_FROM = ['barracks', 'range', 'stables', 'foundry', 'kites', 'shrine', 'wonder'];

export function recruitSite(s: CampaignState, a: ArmyState): { slots: (BuildingSlot | null)[]; level: number; region: string | null } | null {
  if (a.faction === 'drift' && a.city) {
    const st = regionStance(s, a);
    if (st === 'hostile' && !s.regions[a.region]!.mooring) return null;
    return { slots: a.city.slots, level: a.city.level, region: null };
  }
  // The army's own settlement, or troops march out from a neighboring one:
  // the best-equipped of them (a bare village next to the capital should
  // not stop the capital's barracks from sending recruits).
  let best: { slots: (BuildingSlot | null)[]; level: number; region: string } | null = null;
  let bs = -1;
  for (const n of [a.region, ...neighbors(a.region)]) {
    const st = s.regions[n]!;
    if (st.owner !== a.faction || !regionDef(n).settlement) continue;
    let sc = st.level;
    for (const k of RECRUIT_FROM) sc += chainLevel(st, k) * 10;
    if (sc > bs) {
      bs = sc;
      best = { slots: st.slots, level: st.level, region: n };
    }
  }
  return best;
}

export function recruitOptions(s: CampaignState, armyId: string): RecruitOption[] {
  const a = armyById(s, armyId);
  if (!a) return [];
  const site = recruitSite(s, a);
  const fs = s.factions[a.faction];
  return recruitable(a.faction).map((d) => {
    const cost = unitCost(s, a.faction, d, site?.region ?? null);
    const opt: RecruitOption = { def: d, coin: cost.coin, res: cost.res, ok: true };
    const why = (r: string) => {
      opt.ok = false;
      opt.reason = opt.reason ?? r;
    };
    if (!site) why(a.faction === 'drift' ? 'Wind-cities cannot recruit in hostile land' : 'Recruit in your own settlement');
    else {
      const req = recruitRequirement(d);
      const have = chainLevel({ slots: site.slots }, req.kind);
      if (have < req.level) why(`Needs ${kindLabel(a.faction, req.kind, req.level)}`);
      if (site.level < req.cityLevel) why(`Needs a level-${req.cityLevel} ${a.faction === 'drift' ? 'wind-city' : 'settlement'}`);
    }
    if (a.units.length >= MAX_UNITS) why('The army is full (16 units)');
    if (d.category === 'colossus') {
      if (a.units.some((u) => unitDef(u.def).category === 'colossus')) why('One colossus per army');
      if (s.options.colossusUnique && fs.colossus.alive) why('Your colossus already walks');
      if (fs.colossus.rebuildAt > s.turn) why(`Can be rebuilt on Toll ${fs.colossus.rebuildAt}`);
    }
    if (d.category === 'character' && a.units.some((u) => u.def === d.id)) why('One of each hero per army');
    if (fs.coin < opt.coin) why('Not enough coin');
    if (fs.res < opt.res) why(`Not enough ${factionDef(a.faction).resource.name}`);
    return opt;
  });
}

function kindLabel(f: FactionId, kind: string, level: number): string {
  const c = factionChains(f).find((x) => x.kind === kind);
  if (!c) return `a ${kind}`;
  return c.names[Math.min(level, c.names.length) - 1] ?? c.names[0]!;
}

export function recruit(s: CampaignState, armyId: string, defId: string): Result {
  const opt = recruitOptions(s, armyId).find((o) => o.def.id === defId);
  if (!opt) return fail('Unknown unit');
  if (!opt.ok) return fail(opt.reason ?? 'Cannot recruit');
  const a = armyById(s, armyId)!;
  const fs = s.factions[a.faction];
  fs.coin -= opt.coin;
  fs.res -= opt.res;
  const site = recruitSite(s, a)!;
  const rank = site.region ? sumEffect(regionEffectsOf(s, site.region), 'rank') : 0;
  a.units.push({ def: defId, strength: 1, rank: Math.min(3, rank), xp: rank * 50 });
  if (opt.def.category === 'colossus') {
    fs.colossus.alive = true;
    fs.colossus.built = true;
    log(s, 'build', `${opt.def.name} rises to join ${a.name}.`, undefined, a.region);
  }
  return { ok: true };
}

function regionEffectsOf(s: CampaignState, region: string) {
  return s.regions[region]!.slots.filter((x): x is BuildingSlot => !!x && x.level > 0).map((x) => chainDef(x.chain).effects[x.level - 1]!);
}

export function disband(s: CampaignState, armyId: string, index: number): Result {
  const a = armyById(s, armyId);
  if (!a) return fail('No such army');
  const u = a.units[index];
  if (!u) return fail('No such unit');
  if (unitDef(u.def).category === 'colossus') s.factions[a.faction].colossus.alive = false;
  a.units.splice(index, 1);
  return { ok: true };
}

/** Move a unit between two armies in the same region. */
export function transfer(s: CampaignState, fromId: string, index: number, toId: string): Result {
  const a = armyById(s, fromId);
  const b = armyById(s, toId);
  if (!a || !b) return fail('No such army');
  if (a.region !== b.region || a.faction !== b.faction) return fail('Armies must stand together');
  if (b.units.length >= MAX_UNITS) return fail('That army is full');
  const u = a.units[index];
  if (!u) return fail('No such unit');
  if (unitDef(u.def).category === 'colossus' && b.units.some((x) => unitDef(x.def).category === 'colossus')) return fail('One colossus per army');
  a.units.splice(index, 1);
  b.units.push(u);
  b.moves = Math.min(a.moves, b.moves);
  return { ok: true };
}

export function armyCap(s: CampaignState, f: FactionId): number {
  if (f === 'drift') return Math.min(6, 2 + Math.floor(s.factions.drift.res / 250));
  return Math.min(8, 2 + Math.floor(ownedRegions(s, f).length / 3));
}

export const RAISE_COST = 700;

export function canRaiseArmy(s: CampaignState, f: FactionId, region: string): Result {
  const fs = s.factions[f];
  if (factionArmies(s, f).length >= armyCap(s, f)) return fail(`Army limit reached (${armyCap(s, f)}). ${f === 'drift' ? 'Renown' : 'More regions'} raise it.`);
  if (fs.coin < RAISE_COST) return fail('Not enough coin');
  if (f === 'drift') {
    const onRoad = regionDef(region).galeRoad || s.regions[region]!.mooring;
    if (!onRoad) return fail('A new sail is raised on the Gale Roads or at a mooring');
    return { ok: true };
  }
  const r = s.regions[region]!;
  if (r.owner !== f || !regionDef(region).settlement) return fail('Raise armies in your own settlement');
  return { ok: true };
}

export function raiseArmy(s: CampaignState, f: FactionId, region: string): Result<{ army: ArmyState }> {
  const ok = canRaiseArmy(s, f, region);
  if (!ok.ok) return ok;
  const fs = s.factions[f];
  fs.coin -= RAISE_COST;
  fs.armiesRaised++;
  const returning = fs.lordReturns !== undefined && fs.lordReturns <= s.turn && !s.armies.some((x) => x.faction === f && x.lord.legendary);
  const fd = factionDef(f);
  const a: ArmyState = {
    id: nextId(s, 'a'),
    faction: f,
    name: armyName(f, fs.armiesRaised),
    lord: returning
      ? { name: fd.lord.name, def: fd.lord.id, legendary: true, traits: [], wins: 0 }
      : { name: lordName(f, s.seed * 31 + fs.armiesRaised), def: `${f}.captain`, legendary: false, traits: [], wins: 0 },
    units: [],
    region,
    moves: 0,
    stance: 'march',
  };
  if (returning) fs.lordReturns = undefined;
  if (f === 'drift') {
    a.city = { level: 1, slots: [{ chain: 'drift.barracks', level: 1 }, null, null] };
    a.bandsVisited = [bandIndex(s, region)];
  }
  s.armies.push(a);
  return { ok: true, army: a };
}

export const TRAITS: Record<string, { name: string; desc: string; faction: FactionId | 'any'; cost: number }> = {
  lampBearer: { name: 'Lamp-Bearer', desc: 'Carries a sun-lamp: no Dim or Dark penalties to leadership or replenishment, and half attrition in the Evernight.', faction: 'choir', cost: 400 },
  veil: { name: 'Veil-Bearer', desc: 'Carries a Veil: no attrition in Bright or Blaze regions.', faction: 'hush', cost: 400 },
  provisioned: { name: 'Provision Wagons', desc: 'Half attrition in the Evernight and the Glare.', faction: 'vesperate', cost: 350 },
  stormCloaks: { name: 'Storm Cloaks', desc: 'Half attrition in the Evernight and the Glare. The Gale Roads never cost attrition.', faction: 'drift', cost: 350 },
};

export function buyTrait(s: CampaignState, armyId: string, trait: string): Result {
  const a = armyById(s, armyId);
  const t = TRAITS[trait];
  if (!a || !t) return fail('Unknown');
  if (t.faction !== 'any' && t.faction !== a.faction) return fail('Not for this faction');
  if (a.lord.traits.includes(trait)) return fail('Already has it');
  if (!recruitSite(s, a)) return fail('Equip lords in your own settlement or wind-city');
  const fs = s.factions[a.faction];
  if (fs.coin < t.cost) return fail('Not enough coin');
  fs.coin -= t.cost;
  a.lord.traits.push(trait);
  return { ok: true };
}

// --------------------------------------------------------------- buildings

export interface BuildOption {
  chain: ChainDef;
  level: number;
  cost: number;
  resCost: number;
  ok: boolean;
  reason?: string;
}

/** What could go in (or upgrade) a slot. */
export function buildOptions(s: CampaignState, region: string, slot: number): BuildOption[] {
  const r = s.regions[region]!;
  if (r.owner === 'free' || slot < 0 || slot >= r.slots.length) return [];
  const f = r.owner;
  const def = regionDef(region);
  const cur = r.slots[slot];
  const fs = s.factions[f];
  const out: BuildOption[] = [];
  const chains = cur ? [chainDef(cur.chain)] : factionChains(f);
  for (const c of chains) {
    const level = cur ? cur.level + 1 : 1;
    if (level > c.names.length) continue;
    const cost = c.costs[level - 1]!;
    const resCost = c.resCost?.[level - 1] ?? 0;
    const o: BuildOption = { chain: c, level, cost, resCost, ok: true };
    const why = (x: string) => {
      o.ok = false;
      o.reason = o.reason ?? x;
    };
    if (!cur && r.slots.some((x) => x && x.chain === c.id)) why('Already built here');
    if (c.majorOnly && !def.major) why('Major settlements only');
    if (c.river && !def.river) why('Needs a river');
    if (c.unique && REGIONS.some((x) => s.regions[x.id]!.owner === f && s.regions[x.id]!.slots.some((y) => y && y.chain === c.id))) why('Only one per faction');
    if (c.minLevel && r.level < c.minLevel) why(`Needs a level-${c.minLevel} settlement`);
    if (level > r.level) why(`Needs a level-${level} settlement`);
    if (cur?.building || r.slots.some((x) => x?.building)) why('Already building here this Toll');
    if (fs.coin < cost) why('Not enough coin');
    if (fs.res < resCost) why(`Not enough ${factionDef(f).resource.name}`);
    if (c.kind === 'tower' && f === 'choir' && bandIndex(s, region) <= 1 && def.landmark !== 'candle') {
      o.reason = o.reason ?? undefined;
    }
    out.push(o);
  }
  return out;
}

export function build(s: CampaignState, region: string, slot: number, chainId: string): Result {
  const opt = buildOptions(s, region, slot).find((o) => o.chain.id === chainId);
  if (!opt) return fail('Cannot build that here');
  if (!opt.ok) return fail(opt.reason ?? 'Cannot build');
  const r = s.regions[region]!;
  const fs = s.factions[r.owner as FactionId];
  fs.coin -= opt.cost;
  fs.res -= opt.resCost;
  const cur = r.slots[slot];
  if (cur) cur.building = { toLevel: opt.level, turnsLeft: 1 };
  else r.slots[slot] = { chain: chainId, level: 0, building: { toLevel: 1, turnsLeft: 1 } };
  if (fs.id === 'vesperate' && (opt.chain.kind === 'walls' || opt.chain.kind === 'special')) fs.houses.weir = Math.min(100, fs.houses.weir + 3);
  if (fs.id === 'vesperate' && opt.chain.kind === 'market') fs.houses.lantern = Math.min(100, fs.houses.lantern + 3);
  return { ok: true };
}

export function demolish(s: CampaignState, region: string, slot: number): Result {
  const r = s.regions[region]!;
  if (!r.slots[slot]) return fail('Empty slot');
  r.slots[slot] = null;
  return { ok: true };
}

export function canUpgradeSettlement(s: CampaignState, region: string): Result<{ cost: number }> {
  const r = s.regions[region]!;
  if (r.owner === 'free') return fail('Not yours');
  if (r.level >= maxLevel(region)) return fail(regionDef(region).major ? 'Already the greatest city' : 'Minor settlements stop at level 3');
  const need = GROWTH_NEEDED[r.level]!;
  if (r.growth < need) return fail(`Needs ${need} growth (has ${Math.floor(r.growth)})`);
  const cost = LEVEL_COST[r.level]!;
  if (s.factions[r.owner].coin < cost) return fail(`Needs ${cost} coin`);
  return { ok: true, cost };
}

export function upgradeSettlement(s: CampaignState, region: string): Result {
  const ok = canUpgradeSettlement(s, region);
  if (!ok.ok) return ok;
  const r = s.regions[region]!;
  s.factions[r.owner as FactionId].coin -= ok.cost;
  r.growth -= GROWTH_NEEDED[r.level]!;
  r.level++;
  while (r.slots.length < slotCount(region, r.level)) r.slots.push(null);
  log(s, 'build', `${regionDef(region).settlement} grows to level ${r.level}.`, r.owner as FactionId, region);
  return { ok: true };
}

// ------------------------------------------------------ Drift wind-cities

export function cityBuildOptions(s: CampaignState, armyId: string, slot: number): BuildOption[] {
  const a = armyById(s, armyId);
  if (!a?.city || slot < 0 || slot >= a.city.slots.length) return [];
  const cur = a.city.slots[slot];
  const fs = s.factions.drift;
  const out: BuildOption[] = [];
  const chains = cur ? [chainDef(cur.chain)] : factionChains('drift');
  for (const c of chains) {
    const level = cur ? cur.level + 1 : 1;
    if (level > c.names.length) continue;
    const cost = c.costs[level - 1]!;
    const o: BuildOption = { chain: c, level, cost, resCost: 0, ok: true };
    const why = (x: string) => {
      o.ok = false;
      o.reason = o.reason ?? x;
    };
    if (!cur && a.city.slots.some((x) => x && x.chain === c.id)) why('Already aboard');
    if (c.unique && s.armies.some((x) => x.city?.slots.some((y) => y && y.chain === c.id))) why('Only one wind-city can carry it');
    if (c.minLevel && a.city.level < c.minLevel) why(`Needs a level-${c.minLevel} wind-city`);
    if (level > a.city.level) why(`Needs a level-${level} wind-city`);
    if (a.city.slots.some((x) => x?.building)) why('Already building this Toll');
    if (fs.coin < cost) why('Not enough coin');
    out.push(o);
  }
  return out;
}

export function cityBuild(s: CampaignState, armyId: string, slot: number, chainId: string): Result {
  const opt = cityBuildOptions(s, armyId, slot).find((o) => o.chain.id === chainId);
  if (!opt) return fail('Cannot build that');
  if (!opt.ok) return fail(opt.reason ?? 'Cannot build');
  const a = armyById(s, armyId)!;
  s.factions.drift.coin -= opt.cost;
  const cur = a.city!.slots[slot];
  if (cur) cur.building = { toLevel: opt.level, turnsLeft: 1 };
  else a.city!.slots[slot] = { chain: chainId, level: 0, building: { toLevel: 1, turnsLeft: 1 } };
  return { ok: true };
}

export const CITY_COST = [0, 900, 1800];

export function upgradeCity(s: CampaignState, armyId: string): Result {
  const a = armyById(s, armyId);
  if (!a?.city) return fail('Not a wind-city');
  if (a.city.level >= 3) return fail('Already the greatest wind-city');
  const cost = CITY_COST[a.city.level]!;
  const renown = a.city.level === 1 ? 100 : 300;
  if (s.factions.drift.res < renown) return fail(`Needs ${renown} Renown`);
  if (s.factions.drift.coin < cost) return fail(`Needs ${cost} coin`);
  s.factions.drift.coin -= cost;
  a.city.level++;
  a.city.slots.push(null);
  return { ok: true };
}

// ------------------------------------------------------- faction actions

export const HYMNS: Record<HymnId, { name: string; desc: string; cost: number }> = {
  noon: { name: 'Hymn of Noon', desc: '+10% melee damage for every Choir army, for 5 Tolls.', cost: 150 },
  lens: { name: 'Hymn of the Lens', desc: '+15% missile damage and +10% accuracy for every Choir army, for 5 Tolls.', cost: 150 },
  unbowed: { name: 'Hymn of the Unbowed', desc: '+10% leadership and 20% slower fatigue for every Choir army, for 5 Tolls.', cost: 150 },
  harvest: { name: 'Hymn of Harvest', desc: '+30% food from every Choir region, for 5 Tolls.', cost: 120 },
};

export function singHymn(s: CampaignState, id: HymnId): Result {
  const c = s.factions.choir;
  const h = HYMNS[id];
  if (c.hymn) return fail(`${HYMNS[c.hymn.id].name} still sounds for ${c.hymn.turns} Tolls`);
  if (c.res < h.cost) return fail(`Needs ${h.cost} Radiance`);
  c.res -= h.cost;
  c.hymn = { id, turns: 5 };
  log(s, 'info', `The Choir sing the ${h.name}.`);
  return { ok: true };
}

export const PILGRIMAGE_COST = 100;

export function pilgrimage(s: CampaignState, region: string): Result {
  const c = s.factions.choir;
  const r = s.regions[region]!;
  if (!CANDLES.includes(region) && region !== NAIL_SPIRE) return fail('Pilgrimages go to a Candle or the Nail Spire');
  if (r.owner !== 'choir') return fail('Hold it first');
  if (region !== NAIL_SPIRE && !r.lit) return fail('This Candle is dark: relight it first');
  if ((r.ritualCooldown ?? 0) > 0) return fail(`The pilgrims return in ${r.ritualCooldown} Tolls`);
  if (c.res < PILGRIMAGE_COST) return fail(`Needs ${PILGRIMAGE_COST} Radiance`);
  c.res -= PILGRIMAGE_COST;
  r.ritualCooldown = 3;
  s.tiltProgress += 20;
  log(s, 'tilt', `A Candle pilgrimage climbs to ${regionDef(region).settlement}: the Tilt strains sunward.`, undefined, region);
  return { ok: true };
}

export function relight(s: CampaignState, region: string): Result {
  const c = s.factions.choir;
  const r = s.regions[region]!;
  if (!CANDLES.includes(region)) return fail('Not a Candle');
  if (r.owner !== 'choir') return fail('Hold it first');
  if (r.lit) return fail('It burns already');
  if (c.res < 120) return fail('Needs 120 Radiance');
  c.res -= 120;
  r.lit = true;
  log(s, 'tilt', `The Choir relight ${regionDef(region).settlement}.`, undefined, region);
  return { ok: true };
}

export const CRUSADE_ZEAL = 60;

export function crusade(s: CampaignState, armyId: string, target: string): Result {
  const c = s.factions.choir;
  const a = armyById(s, armyId);
  if (!a || a.faction !== 'choir') return fail('Choir armies only');
  if (c.zeal < CRUSADE_ZEAL) return fail(`Needs ${CRUSADE_ZEAL} Zeal`);
  if (s.armies.some((x) => x.crusade)) return fail('A crusade is already marching');
  const o = s.regions[target]!.owner;
  if (o === 'choir') return fail('Crusade against a foe');
  c.zeal -= CRUSADE_ZEAL;
  a.crusade = { target, turns: 12 };
  log(s, 'info', `${a.name} declares a Crusade on ${regionDef(target).settlement}!`, undefined, target);
  return { ok: true };
}

export const LENS_COST = { coin: 1500, res: 150 };

export function lensReady(s: CampaignState): Result {
  const c = s.factions.choir;
  if (c.lens >= 5) return fail('The Last Lens is complete');
  if (s.turn < 50) return fail('The world is not ready: the Last Lens can begin on Toll 50');
  if (c.lensBuilding) return fail('A stage is being built');
  if (s.regions[NAIL_SPIRE]!.owner !== 'choir') return fail('Hold the Nail Spire');
  if (!CANDLES.every((x) => s.regions[x]!.owner === 'choir' && s.regions[x]!.lit)) return fail('Hold all three Candles, lit');
  if (s.tilt < 3) return fail('The Tilt must be +3 or higher');
  if (c.coin < LENS_COST.coin || c.res < LENS_COST.res) return fail(`Needs ${LENS_COST.coin} coin and ${LENS_COST.res} Radiance`);
  return { ok: true };
}

export function buildLensStage(s: CampaignState): Result {
  const ok = lensReady(s);
  if (!ok.ok) return ok;
  const c = s.factions.choir;
  c.coin -= LENS_COST.coin;
  c.res -= LENS_COST.res;
  c.lensBuilding = true;
  log(s, 'victory', `The Choir begin stage ${c.lens + 1} of the Last Lens at the Nail Spire.`);
  return { ok: true };
}

export function listen(s: CampaignState, region: string): Result {
  const h = s.factions.hush;
  const r = s.regions[region]!;
  const candle = CANDLES.includes(region);
  if (region !== POLE && !candle) return fail('The Listening is held at the Pole of Night or a captured Candle');
  if (r.owner !== 'hush') return fail('Hold it first');
  if ((r.ritualCooldown ?? 0) > 0) return fail(`The stones are quiet for ${r.ritualCooldown} more Tolls`);
  if (h.coin < 300) return fail('Needs 300 coin');
  h.coin -= 300;
  r.ritualCooldown = 3;
  s.tiltProgress -= region === POLE ? 20 : 15;
  h.res = Math.min(100, h.res + 3);
  log(s, 'tilt', `The Hush hold the Listening at ${regionDef(region).settlement}: the Tilt strains nightward.`, undefined, region);
  return { ok: true };
}

export function extinguish(s: CampaignState, region: string): Result {
  const r = s.regions[region]!;
  if (!CANDLES.includes(region)) return fail('Not a Candle');
  if (r.owner !== 'hush') return fail('Hold it first');
  if (!r.lit) return fail('Already dark');
  r.lit = false;
  s.factions.hush.res = Math.min(100, s.factions.hush.res + 10);
  log(s, 'tilt', `The Hush put out ${regionDef(region).settlement}. Its gold summit goes dark.`, undefined, region);
  return { ok: true };
}

export const OBSERVANCES: Record<ObservanceId, { name: string; desc: string; hours: number }> = {
  harvest: { name: 'Harvest', desc: '+25% food in every Vesperate region.', hours: 4 },
  muster: { name: 'Muster', desc: '−25% recruitment cost.', hours: 4 },
  market: { name: 'Market', desc: '+20% coin from every Vesperate region.', hours: 4 },
  vigil: { name: 'Vigil', desc: '+4 public order in every Vesperate region.', hours: 4 },
};

/** Observances are planned ahead: any slot but the one ringing now. */
export function setObservance(s: CampaignState, slot: number, id: ObservanceId): Result {
  const v = s.factions.vesperate;
  if (slot < 0 || slot >= v.calendar.length) return fail('No such slot');
  if (slot === s.turn % v.calendar.length) return fail('This Observance is already ringing');
  v.calendar[slot] = id;
  return { ok: true };
}

export function giftHouse(s: CampaignState, house: HouseId): Result {
  const v = s.factions.vesperate;
  if (v.coin < 200) return fail('Needs 200 coin');
  v.coin -= 200;
  v.houses[house] = Math.min(100, v.houses[house] + 10);
  return { ok: true };
}

export const GREAT_TOLL = { coin: 1000, res: 60 };
/** Tolls the great bells rest after ringing: long enough for a determined push to move the Tilt. */
export const GREAT_TOLL_REST = 7;

export function greatToll(s: CampaignState): Result {
  const v = s.factions.vesperate;
  if (s.tilt === 0 && Math.abs(s.tiltProgress) < 1) return fail('The world already keeps the Hour');
  if (v.greatTollCooldown > 0) return fail(`The great bells rest for ${v.greatTollCooldown} more Tolls`);
  if (v.coin < GREAT_TOLL.coin || v.res < GREAT_TOLL.res) return fail(`Needs ${GREAT_TOLL.coin} coin and ${GREAT_TOLL.res} Hours`);
  v.coin -= GREAT_TOLL.coin;
  v.res -= GREAT_TOLL.res;
  v.greatTollCooldown = GREAT_TOLL_REST;
  if (s.tilt !== 0) s.tilt += s.tilt > 0 ? -1 : 1;
  s.tiltProgress = 0;
  log(s, 'tilt', `The Great Toll rings from Vesper: the Tilt swings back to ${fmtTilt(s.tilt)}.`);
  return { ok: true };
}

export function fmtTilt(t: number): string {
  return t > 0 ? `+${t}` : `${t}`;
}

/** Drift: a threatened free settlement pays tribute and grants a mooring. */
export function demandTribute(s: CampaignState, armyId: string, power: (a: ArmyState) => number, garrisonPower: (region: string) => number): Result {
  const a = armyById(s, armyId);
  if (!a || a.faction !== 'drift') return fail('Drift sails only');
  const r = s.regions[a.region]!;
  if (r.owner !== 'free' || !regionDef(a.region).settlement) return fail('Only free settlements pay tribute');
  if (r.mooring) return fail('Already moored');
  if (power(a) < garrisonPower(a.region) * 2) return fail('Not threatening enough: bring twice their strength');
  r.mooring = true;
  s.factions.drift.coin += 250;
  s.factions.drift.res += 10;
  a.moves = 0;
  log(s, 'capture', `${regionDef(a.region).settlement} pays tribute to the Drift and grants a mooring.`, undefined, a.region);
  return { ok: true };
}

export function armiesAt(s: CampaignState, region: string): ArmyState[] {
  return armiesIn(s, region);
}

export function resetMoves(a: ArmyState): void {
  a.moves = maxMoves(a);
}

export { capitalOf, cityEffects };
