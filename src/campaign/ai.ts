/**
 * Scripted campaign AI: one pass per faction per Toll. Each faction reads
 * the map (threats, targets, the race to victory), then builds, recruits,
 * uses its own mechanics and marches, in character: the Choir zealous, the
 * Hush patient and fond of the Shadow Roads, the Vesperate cautious, the
 * Drift opportunistic. It is the fallback when Jev is off or offline, and
 * it plays every faction in headless test campaigns.
 *
 * Every choice is deterministic: ties break on the campaign state (turn,
 * ids, map order), never on Math.random, so a campaign replays exactly
 * from its seed.
 */
import type { FactionId, Role } from '../data/schema';
import { FACTION_IDS } from '../data/schema';
import { unitDef } from '../data/index';
import type { AiMemory, ArmyState, CampaignState, ObservanceId, Owner, PendingBattle } from './types';
import { CANDLES, KITE_FIELDS, NAIL_SPIRE, POLE, REGIONS, RESOURCES, STOPPED_DIAL, VALES, regionDef } from './regions';
import { neighbors, stepsFrom } from './geometry';
import { chainDef, factionChains, type ChainDef, type ChainKind } from './buildings';
import { allied, armyById, atWar, factionArmies, ownedRegions, overlordOf, relation } from './state';
import {
  GROWTH_NEEDED,
  armyPower,
  armyUpkeep,
  bandIndex,
  battleLeadership,
  blocksPath,
  chainLevel,
  conquestUnrest,
  currentObservance,
  findPath,
  herdIn,
  maxMoves,
  orderDelta,
  regionStance,
  stepCost,
  strengthOf,
  wallLevel,
} from './rules';
import {
  MAX_UNITS,
  CITY_COST,
  GREAT_TOLL,
  LENS_COST,
  PILGRIMAGE_COST,
  RAISE_COST,
  TRAITS,
  armyCap,
  assault,
  build,
  buildLensStage,
  buildOptions,
  buyTrait,
  canRaiseArmy,
  canUpgradeSettlement,
  cityBuild,
  cityBuildOptions,
  crusade,
  demandTribute,
  demolish,
  disband,
  extinguish,
  giftHouse,
  greatToll,
  hostileArmiesIn,
  hostileSettlement,
  lensReady,
  listen,
  makeBattle,
  moveArmy,
  pilgrimage,
  raiseArmy,
  recruit,
  recruitOptions,
  recruitSite,
  relight,
  setObservance,
  setStance,
  singHymn,
  upgradeCity,
  upgradeSettlement,
  type BuildOption,
} from './actions';
import { attackerPower, defenderPower, garrisonPower, sunForAttacker, MAX_SIDE_UNITS } from './battles';
import { declareWar, factionStrength, propose, valueDeal, type Deal } from './diplomacy';
import type { AiContext } from './controller';
import { factionLedger, ledgerNet } from './turn';
import { HOLD_NEEDED, VICTORY_OPENS, gloamingSettlements, kiteFieldsHeld, victoryStatus } from './victory';
import { consultJev } from './jev';

// -------------------------------------------------------------- character

interface Persona {
  /** Odds (effective power ratio) wanted before a field battle. */
  nerve: number;
  /** Appetite for new wars. */
  warlike: number;
  /** Coin kept back, in Tolls of any upkeep shortfall. */
  thrift: number;
}

const PERSONA: Record<FactionId, Persona> = {
  choir: { nerve: 1.15, warlike: 1.3, thrift: 2 },
  hush: { nerve: 1.25, warlike: 1.05, thrift: 2 },
  vesperate: { nerve: 1.3, warlike: 0.75, thrift: 3 },
  drift: { nerve: 1.3, warlike: 0.9, thrift: 2 },
};

/**
 * How auto-resolved battles tend to go for each faction by light band,
 * measured on even test fights (1 = even). The AI weighs its odds with it.
 */
const EDGE: Record<FactionId, number[]> = {
  choir: [1.0, 1.05, 1.05, 1.15, 1.18],
  hush: [1.02, 1.0, 0.95, 0.9, 0.88],
  vesperate: [1.18, 1.18, 1.15, 1.08, 1.1],
  drift: [0.82, 0.82, 0.87, 0.9, 0.84],
};

/**
 * Walled garrisons do worse in auto-resolved assaults than their numbers
 * suggest (attackers often seize the square), unwalled ones a little.
 */
const GARRISON_EFF = { walled: 0.75, open: 0.9 };

/** Army make-up per 16 units, by battle role. */
const DOCTRINE: Record<FactionId, Partial<Record<Role, number>>> = {
  choir: { line: 3, antiLarge: 2, shock: 1, missile: 4, missileCav: 1, shockCav: 2, artillery: 1, monster: 1, hero: 1 },
  hush: { line: 3, antiLarge: 2, shock: 2, missile: 3, support: 1, shockCav: 2, flyer: 1, artillery: 1, monster: 1 },
  vesperate: { line: 3, antiLarge: 3, shock: 1, missile: 4, missileCav: 1, shockCav: 1, artillery: 2, support: 1 },
  drift: { line: 2, antiLarge: 2, shock: 1, missile: 3, missileCav: 3, shockCav: 2, flyer: 1, support: 1, artillery: 1 },
};

/** Worth of one point of the faction resource, in coin, for building choices. */
const RES_WORTH: Record<FactionId, number> = { choir: 14, hush: 5, vesperate: 16, drift: 4 };

const GALE_ROAD = REGIONS.filter((r) => r.galeRoad).map((r) => r.id);

// ------------------------------------------------------------------ entry

export async function scriptedAI(s: CampaignState, f: FactionId, ctx: AiContext): Promise<void> {
  if (!s.factions[f].alive) return;
  await consultJev(s, f, ctx.offer);
  diplomacy(s, f, look(s, f));
  await offers(s, f, look(s, f), ctx);
  let v = look(s, f);
  mechanics(s, f, v);
  if (v.urgent) {
    recruitment(s, f, v);
    economy(s, f, v);
  } else {
    economy(s, f, v);
    recruitment(s, f, v);
  }
  const done = new Set<string>();
  for (let round = 0; round < 3; round++) {
    const pbs = military(s, f, look(s, f), done);
    if (!pbs.length) break;
    await ctx.battles(pbs);
    if (!s.factions[f].alive) return;
  }
  v = look(s, f);
  afterMarch(s, f, v);
}

// ---------------------------------------------------------------- the view

interface View {
  f: FactionId;
  /** 0 early (expand), 1 middle (the Gloaming wars), 2 late (victory races). */
  phase: 0 | 1 | 2;
  wars: FactionId[];
  net: number;
  foodNet: number;
  reserve: number;
  /** Hostile power that could strike each region next Toll. */
  threat: Record<string, number>;
  /** Extra worth of regions for our victory, or to stop a rival's. */
  bonus: Record<string, number>;
  /** Regions a rival needs for its victory: 7+ when it is in its final stage. */
  deny: Record<string, number>;
  /** A rival close to winning (final stage) or running away with the map. */
  leader: FactionId | null;
  strength: Record<FactionId, number>;
  /** Regions that would riot without an army in them. */
  needGarrison: Set<string>;
  /** At war with enemies near: troops before buildings. */
  urgent: boolean;
  capital: string | null;
  /** Food is short: new land that eats more than it grows is unwelcome. */
  hungry: boolean;
  /** Towns of ours heading for revolt: time to settle before conquering more. */
  unrest: number;
  /** A rival at war with us will win before we do unless stopped now. */
  desperate: boolean;
  /** A strategic focus in force (set by Jev), or null for the usual course. */
  focus: AiMemory['focus'] | null;
  /** Coin put by for a great work (the wonder, the colossus, a Lens stage) that routine spending leaves alone. */
  saving: number;
  /** Our towns that train the line (a barracks or a range), and the land within two steps of one. */
  hubs: string[];
  nearHub: Set<string>;
}

/** A wonder we could raise soon: the chain, and a town with room for it. */
function wonderPlan(s: CampaignState, f: FactionId): { chain: ChainDef; site: string | null } | null {
  const chain = factionChains(f).find((c) => c.kind === 'wonder');
  if (!chain || s.turn < WONDER_TURN[f]) return null;
  if (f === 'drift') {
    // Sails first: the Drift live only as long as their wind-cities do.
    if (factionArmies(s, 'drift').length < 3) return null;
    if (s.armies.some((a) => a.city?.slots.some((x) => x && chainDef(x.chain).kind === 'wonder'))) return null;
    const city = factionArmies(s, 'drift').find((a) => a.city && a.city.level >= (chain.minLevel ?? 1) && a.city.slots.some((x) => !x));
    return city ? { chain, site: null } : null;
  }
  if (ownedRegions(s, f).some((r) => s.regions[r]!.slots.some((x) => x && x.chain === chain.id))) return null;
  const site = ownedRegions(s, f).find((r) => regionDef(r).major && s.regions[r]!.level >= (chain.minLevel ?? 1) && s.regions[r]!.slots.some((x) => !x));
  return site ? { chain, site } : null;
}

/** The colossus can be raised: its wonder stands and it does not walk. */
function colossusDue(s: CampaignState, f: FactionId): boolean {
  const fs = s.factions[f];
  if (fs.colossus.alive || fs.colossus.rebuildAt > s.turn) return false;
  if (f === 'drift') return s.armies.some((a) => a.faction === 'drift' && a.city?.slots.some((x) => x && x.level > 0 && chainDef(x.chain).kind === 'wonder'));
  return ownedRegions(s, f).some((r) => s.regions[r]!.slots.some((x) => x && x.level > 0 && chainDef(x.chain).kind === 'wonder'));
}

function savingFor(s: CampaignState, f: FactionId, urgent: boolean): number {
  if (urgent) return 0;
  let save = 0;
  const w = wonderPlan(s, f);
  if (w) save = Math.max(save, w.chain.costs[0]!);
  if (colossusDue(s, f)) save = Math.max(save, 3200);
  if (f === 'choir' && s.turn >= VICTORY_OPENS - 3 && s.factions.choir.lens < 5 && s.regions[NAIL_SPIRE]!.owner === 'choir' && CANDLES.every((c) => s.regions[c]!.owner === 'choir')) save = Math.max(save, LENS_COST.coin * (s.factions.choir.lens >= 1 ? 1 : 2));
  return save;
}

/** Tolls a faction still needs to win once in its final stage (Infinity if not in it). */
function tollsToWin(s: CampaignState, f: FactionId): number {
  const fs = s.factions[f];
  const imminent = !fs.finalStage && s.turn >= VICTORY_OPENS - 4 && closeToWinning(s, f);
  if (!fs.finalStage && !imminent) return Infinity;
  const need = f === 'choir' ? 5 - fs.lens : HOLD_NEEDED[f] - fs.hold;
  return need + (imminent ? Math.max(1, VICTORY_OPENS - s.turn) : 0);
}

function look(s: CampaignState, f: FactionId): View {
  const fs = s.factions[f];
  const wars = FACTION_IDS.filter((o) => o !== f && s.factions[o].alive && atWar(s, f, o));
  const n = ledgerNet(factionLedger(s, f));
  const reserve = Math.max(250, PERSONA[f].thrift * Math.max(0, -n.coin)) + (wars.length ? 200 : 0);
  const threat = threatMap(s, f);
  const strength = {} as Record<FactionId, number>;
  for (const o of FACTION_IDS) strength[o] = s.factions[o].alive ? factionStrength(s, o) : 0;
  const leader = findLeader(s, f, strength);
  const capital = capitalFor(s, f);
  const v: View = {
    f,
    phase: s.turn < 26 ? 0 : s.turn < 61 ? 1 : 2,
    wars,
    net: n.coin,
    foodNet: n.food,
    reserve,
    threat,
    bonus: {},
    deny: {},
    leader,
    strength,
    needGarrison: new Set(),
    urgent: false,
    capital,
    hungry: fs.food < 40 || (n.food < 0 && fs.food + n.food * 8 < 0),
    unrest: 0,
    desperate: false,
    focus: fs.ai?.focus && fs.ai.focus.until > s.turn ? fs.ai.focus : null,
    saving: 0,
    hubs: [],
    nearHub: new Set(),
  };
  if (f !== 'drift') {
    v.hubs = ownedRegions(s, f).filter((r) => regionDef(r).settlement && (chainLevel(s.regions[r]!, 'barracks') > 0 || chainLevel(s.regions[r]!, 'range') > 0));
    for (const h of v.hubs) {
      const steps = stepsFrom(h);
      for (const id in steps) if (steps[id]! <= 2) v.nearHub.add(id);
    }
  }
  const mine = tollsToWin(s, f);
  v.desperate = wars.some((o) => tollsToWin(s, o) <= mine && tollsToWin(s, o) < Infinity);
  v.bonus = victoryBonus(s, f, v);
  v.urgent = wars.length > 0 && ownedRegions(s, f).some((r) => (threat[r] ?? 0) > defenseOf(s, f, r) * 0.7);
  v.saving = savingFor(s, f, v.urgent);
  for (const r of ownedRegions(s, f)) {
    if (!regionDef(r).settlement) continue;
    const low = orderLow(s, f, r, pendingOrder(s, r));
    if (low <= -14) v.unrest++;
    if (low <= -17) v.needGarrison.add(r);
  }
  return v;
}

const HOME: Record<FactionId, string | null> = { choir: 'aumsgate', hush: 'pole', vesperate: 'vesper', drift: null };

function capitalFor(s: CampaignState, f: FactionId): string | null {
  if (f === 'drift') return null;
  const own = ownedRegions(s, f);
  const home = HOME[f]!;
  if (own.includes(home)) return home;
  let best: string | null = null;
  let bs = -1;
  for (const r of own) {
    const st = s.regions[r]!;
    const sc = st.level * 10 + (regionDef(r).major ? 5 : 0) + st.slots.filter(Boolean).length;
    if (sc > bs) {
      bs = sc;
      best = r;
    }
  }
  return best;
}

/** A rival in its final stage, or one that has pulled far ahead late in the game. */
function findLeader(s: CampaignState, f: FactionId, strength: Record<FactionId, number>): FactionId | null {
  const rivals = FACTION_IDS.filter((o) => o !== f && s.factions[o].alive);
  const final = rivals.find((o) => s.factions[o].finalStage) ?? rivals.find((o) => s.turn >= VICTORY_OPENS - 4 && closeToWinning(s, o));
  if (final) return final;
  if (s.turn < 45) return null;
  const all = FACTION_IDS.filter((o) => s.factions[o].alive).sort((a, b) => strength[b] - strength[a]);
  const top = all[0];
  const second = all[1];
  if (!top || !second || top === f) return null;
  return strength[top] > strength[second] * 1.6 && ownedRegions(s, top).length >= 12 ? top : null;
}

/**
 * Hostile power that could strike each region next Toll: the strongest
 * enemy's armies in reach in full, other enemies' at half (they seldom
 * strike the same town together).
 */
function threatMap(s: CampaignState, f: FactionId): Record<string, number> {
  const by: Record<string, Partial<Record<FactionId, number>>> = {};
  const add = (id: string, o: FactionId, p: number) => {
    const m = (by[id] ??= {});
    m[o] = (m[o] ?? 0) + p;
  };
  for (const h of s.armies) {
    if (h.faction === f || !atWar(s, f, h.faction)) continue;
    const p = armyPower(h);
    const steps = stepsFrom(h.region);
    const reach = h.faction === 'drift' && regionDef(h.region).galeRoad ? 3 : 2;
    for (const id in steps) if (steps[id]! <= reach) add(id, h.faction, p * (steps[id]! <= 1 ? 1 : 0.8));
    if (h.faction === 'hush' && regionDef(h.region).vale) {
      for (const vale of VALES) if (steps[vale]! > reach) add(vale, 'hush', p * 0.8);
    }
  }
  const t: Record<string, number> = {};
  for (const id in by) {
    const vals = Object.values(by[id]!).sort((a, b) => b - a);
    t[id] = vals[0]! + vals.slice(1).reduce((x, y) => x + y, 0) * 0.5;
  }
  return t;
}

// ----------------------------------------------------------- the estimates

/** Battle power of armies fighting together: a side fields 24 units at most. */
function sidePower(armies: ArmyState[]): number {
  let n = 0;
  let p = 0;
  for (const a of armies) {
    if (n >= MAX_SIDE_UNITS) break;
    p += unitDef(a.lord.def).cost * 0.8;
    n++;
    for (const u of a.units) {
      if (n >= MAX_SIDE_UNITS) break;
      p += strengthOf(u);
      n++;
    }
  }
  return p;
}

function edgeOf(s: CampaignState, f: Owner, region: string, enemy: Owner, a: ArmyState | null): number {
  if (f === 'free') return EDGE[s.regions[region]!.culture][bandIndex(s, region)]!;
  let m = EDGE[f][bandIndex(s, region)]!;
  if (f === 'drift' && regionDef(region).galeRoad) m *= 1.05;
  m *= 1 + battleLeadership(s, a, f, enemy, region).pct / 200;
  if (f === 'choir' && s.factions.choir.hymn && s.factions.choir.hymn.id !== 'harvest') m *= 1.04;
  return m;
}

function garrisonEff(s: CampaignState, region: string): number {
  return garrisonPower(s, region) * (wallLevel(s, region) > 0 ? GARRISON_EFF.walled : GARRISON_EFF.open);
}

/** What holds a region of ours: its garrison and our armies in it. */
function defenseOf(s: CampaignState, f: FactionId, region: string): number {
  const st = s.regions[region]!;
  const armies = s.armies.filter((a) => a.region === region && a.faction === f);
  const walls = wallLevel(s, region);
  let d = sidePower(armies) * (1 + walls * 0.1);
  if (st.owner === f && regionDef(region).settlement) d += garrisonEff(s, region);
  return d;
}

function fill(a: ArmyState): number {
  return a.units.length / MAX_UNITS;
}

function health(a: ArmyState): number {
  if (!a.units.length) return 0;
  return a.units.reduce((t, u) => t + u.strength, 0) / a.units.length;
}

/** Hashing for deterministic variety: 0..1 from the state, never Math.random. */
function noise(s: CampaignState, key: string): number {
  let h = (s.seed * 2654435761 + s.turn * 40503) | 0;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  h ^= h >>> 13;
  h = Math.imul(h, 2246822519);
  h ^= h >>> 16;
  return ((h >>> 0) % 10000) / 10000;
}

function memory(s: CampaignState, f: FactionId): AiMemory {
  const fs = s.factions[f];
  if (!fs.ai) fs.ai = {};
  return fs.ai;
}

// ----------------------------------------------------- victory and denial

function victoryBonus(s: CampaignState, f: FactionId, v: View): Record<string, number> {
  const b: Record<string, number> = {};
  const add = (id: string, x: number) => {
    b[id] = (b[id] ?? 0) + x;
  };
  const late = s.turn >= VICTORY_OPENS - 8;
  if (f === 'choir') {
    for (const c of CANDLES) add(c, late ? 6 : 2.5);
    add(NAIL_SPIRE, late ? 6 : 4);
  } else if (f === 'hush') {
    for (const c of CANDLES) add(c, s.regions[c]!.lit ? (late ? 6 : 3.5) : 1.5);
    add(NAIL_SPIRE, late ? 7 : 1.5);
  } else if (f === 'vesperate') {
    for (const g of gloamingSettlements(s)) add(g, late ? 5 : 2.5);
    add(STOPPED_DIAL, 4);
  }
  // The last pieces of our own victory.
  for (const g of goalRegions(s, f)) add(g, 4);
  // Stop a rival close to winning: everyone joins in.
  for (const o of FACTION_IDS) {
    if (o === f || !s.factions[o].alive || !atWar(s, f, o)) continue;
    const imminent = s.turn >= VICTORY_OPENS - 4 && closeToWinning(s, o);
    const near = s.factions[o].finalStage || imminent || (s.turn >= VICTORY_OPENS - 5 && victoryStatus(s, o).progress >= 0.6) || v.leader === o;
    if (!near) continue;
    // Final stage: the closer to the end of the hold, the more desperate.
    const hold = o === 'choir' ? s.factions.choir.lens / 5 : s.factions[o].hold / Math.max(1, HOLD_NEEDED[o]);
    const w = s.factions[o].finalStage || imminent ? 7 + hold * 4 : 3;
    const deny = (id: string, x: number) => {
      add(id, x);
      v.deny[id] = Math.max(v.deny[id] ?? 0, x);
    };
    if (o === 'vesperate') {
      for (const g of gloamingSettlements(s)) if (s.regions[g]!.owner === 'vesperate') deny(g, w);
      if (s.regions[STOPPED_DIAL]!.owner === 'vesperate') deny(STOPPED_DIAL, w * 0.8);
    } else if (o === 'choir') {
      for (const c of CANDLES) if (s.regions[c]!.owner === 'choir') deny(c, w);
      if (s.regions[NAIL_SPIRE]!.owner === 'choir') deny(NAIL_SPIRE, w);
    } else if (o === 'hush') {
      if (s.regions[NAIL_SPIRE]!.owner === 'hush') deny(NAIL_SPIRE, w * 1.2);
      if (f === 'choir') for (const c of CANDLES) if (!s.regions[c]!.lit) deny(c, w * 0.8);
    } else if (o === 'drift') {
      deny(KITE_FIELDS, w * 1.5);
    }
    // A leader by sheer size: its richest land.
    if (!s.factions[o].finalStage && v.leader === o) for (const r of ownedRegions(s, o)) if (regionDef(r).major) add(r, 2);
  }
  return b;
}

/**
 * A rival that meets every condition of its victory but the calendar (and
 * the Tolls it must hold): the world can see it coming.
 */
function closeToWinning(s: CampaignState, o: FactionId): boolean {
  const r = s.regions;
  if (o === 'drift') return s.factions.drift.res >= 1000 && kiteFieldsHeld(s);
  if (o === 'vesperate') return r[STOPPED_DIAL]!.owner === 'vesperate' && Math.abs(s.tilt) <= 1 && gloamingSettlements(s).every((g) => r[g]!.owner === 'vesperate');
  if (o === 'hush') return r[NAIL_SPIRE]!.owner === 'hush' && s.tilt <= -3 && CANDLES.every((c) => !r[c]!.lit);
  return r[NAIL_SPIRE]!.owner === 'choir' && s.tilt >= 3 && CANDLES.every((c) => r[c]!.owner === 'choir' && r[c]!.lit);
}

/**
 * The last regions we need for our own victory, when little else is
 * missing (the Tilt about right, at most two places to take): these are
 * taken before anything else is guarded.
 */
function goalRegions(s: CampaignState, f: FactionId): string[] {
  if (s.turn < VICTORY_OPENS - 4) return [];
  const r = s.regions;
  let need: string[];
  let tiltOk: boolean;
  if (f === 'choir') {
    need = [NAIL_SPIRE, ...CANDLES].filter((x) => r[x]!.owner !== 'choir');
    tiltOk = s.tilt >= 2;
  } else if (f === 'hush') {
    // Dark Candles in other hands stay dark: only the lit ones must fall.
    need = [NAIL_SPIRE, ...CANDLES.filter((c) => r[c]!.lit)].filter((x) => r[x]!.owner !== 'hush');
    tiltOk = s.tilt <= -2;
  } else if (f === 'vesperate') {
    need = [...gloamingSettlements(s), STOPPED_DIAL].filter((x) => r[x]!.owner !== 'vesperate');
    tiltOk = Math.abs(s.tilt) <= 1;
  } else return [];
  return need.length <= 2 && tiltOk ? need : [];
}

/** The regions a rival's victory rests on. */
function criticalRegions(s: CampaignState, o: FactionId): string[] {
  if (o === 'drift') return [KITE_FIELDS];
  if (o === 'vesperate') return [...gloamingSettlements(s), STOPPED_DIAL].filter((g) => s.regions[g]!.owner === 'vesperate');
  if (o === 'hush') return [NAIL_SPIRE, ...CANDLES].filter((g) => s.regions[g]!.owner === 'hush');
  return [NAIL_SPIRE, ...CANDLES].filter((g) => s.regions[g]!.owner === 'choir');
}

/** How much a region is worth to faction f. */
function regionValue(s: CampaignState, f: FactionId, id: string, v: View): number {
  const r = regionDef(id);
  const st = s.regions[id]!;
  let x = 1;
  if (r.settlement) x += r.major ? 3 : 1.5;
  x += Math.max(0, st.level - 1) * 0.5;
  x += RESOURCES[r.resource].coin / 40 + (RESOURCES[r.resource].food ?? 0) * 0.2;
  const band = bandIndex(s, id);
  if (f === 'choir') x += [-2, -1, 0, 0.5, 0.5][band]!;
  if (f === 'hush') x += [0.5, 0.5, -0.3, -1.2, -2.5][band]!;
  if (f === 'vesperate') x += [-2, -0.5, 1.2, -0.3, -2][band]!;
  if (id === POLE && f !== 'hush') x += 1;
  if (id === POLE && f === 'hush') x += 6;
  // A lost home capital is taken back first.
  if (f !== 'drift' && id === HOME[f] && st.owner !== f) x += 4;
  if (st.owner !== 'free' && st.owner !== f) x += 0.5;
  // Compact realms hold better: land next to ours is worth more.
  if (f !== 'drift' && neighbors(id).some((n) => s.regions[n]!.owner === f)) x += 1;
  // Land that cannot feed itself is a burden when the granaries are low.
  if (f !== 'drift') x += foodIfOurs(s, f, id) * (v.hungry ? 0.5 : 0.15);
  // Settle unruly towns before taking more.
  if (st.owner === 'free' && v.unrest >= 2) x -= Math.min(3, v.unrest - 1);
  x += v.bonus[id] ?? 0;
  // A chosen focus: free land, a named enemy, or our own victory.
  if (v.focus?.kind === 'expand' && st.owner === 'free') x += 2;
  if (v.focus?.kind === 'war' && st.owner === v.focus.target) x += 2.5;
  if (v.focus?.kind === 'victory') x += ((v.bonus[id] ?? 0) - (v.deny[id] ?? 0)) * 0.6;
  return x;
}

/** Food from a region's farms and gardens as they stand. */
function farmFood(s: CampaignState, id: string): number {
  const st = s.regions[id]!;
  let food = 0;
  for (const sl of st.slots) if (sl && sl.level > 0) food += chainDef(sl.chain).effects[sl.level - 1]!.food ?? 0;
  const owner = st.owner;
  return owner === 'hush' ? food : food * [0.25, 0.6, 1.3, 1, 0.25][bandIndex(s, id)]!;
}

/** The food a region would give us each Toll, before farms. */
function foodIfOurs(s: CampaignState, f: FactionId, id: string): number {
  const def = regionDef(id);
  const band = bandIndex(s, id);
  let food = f === 'hush' ? herdIn(s, id) * 2 : [0, 1, 4, 2, 0][band]!;
  food += RESOURCES[def.resource].food ?? 0;
  return food - Math.max(1, s.regions[id]!.level);
}

// ---------------------------------------------------------------- diplomacy

function bordering(s: CampaignState, f: FactionId, o: FactionId): boolean {
  const mine = new Set<string>(ownedRegions(s, f));
  for (const a of factionArmies(s, f)) mine.add(a.region);
  for (const r of ownedRegions(s, o)) {
    if (mine.has(r) || neighbors(r).some((n) => mine.has(n))) return true;
  }
  for (const a of factionArmies(s, o)) if (mine.has(a.region) || neighbors(a.region).some((n) => mine.has(n))) return true;
  return false;
}

/** Free settlements next to our land or armies: room to grow without a war. */
function freeRoom(s: CampaignState, f: FactionId): number {
  const near = new Set<string>();
  for (const r of ownedRegions(s, f)) for (const n of neighbors(r)) near.add(n);
  for (const a of factionArmies(s, f)) for (const n of neighbors(a.region)) near.add(n);
  let k = 0;
  for (const id of near) if (regionDef(id).settlement && s.regions[id]!.owner === 'free' && !(f === 'drift' && s.regions[id]!.mooring)) k++;
  return k;
}

function recentFighting(s: CampaignState, f: FactionId, o: FactionId, tolls: number): number {
  return s.reports.filter((r) => r.turn >= s.turn - tolls && ((r.attacker === f && r.defender === o) || (r.attacker === o && r.defender === f))).length;
}

function lostTo(s: CampaignState, f: FactionId, o: FactionId, tolls: number): number {
  return s.reports.filter((r) => r.turn >= s.turn - tolls && r.captured && r.attacker === o && r.defender === f).length;
}

function diplomacy(s: CampaignState, f: FactionId, v: View): void {
  const mem = memory(s, f);
  const me = v.strength[f];
  for (const o of FACTION_IDS) {
    if (o === f || !s.factions[o].alive) continue;
    if (overlordOf(s, f) === o || overlordOf(s, o) === f) continue;
    const rel = relation(s, f, o);
    const them = v.strength[o];
    const theirs = s.factions[o];
    // Everyone gangs up on a faction in its final victory stage (but the
    // landless Drift, who cannot take the towns a victory rests on and
    // would only draw its armies onto their sails).
    if (theirs.finalStage && f !== 'drift') {
      if (rel.stance !== 'war') {
        declareWar(s, f, o);
        (mem.coalition ??= {})[o] = s.turn;
      }
      continue;
    }
    if (rel.stance === 'war') {
      if (mem.holdWar && mem.holdWar.target === o && mem.holdWar.until > s.turn) continue;
      const age = s.turn - rel.since;
      // A war fought only to stop their victory ends once the danger passes.
      const joined = mem.coalition?.[o];
      if (joined !== undefined && !closeToWinning(s, o) && s.turn - joined >= 3 && !theirs.player) {
        suePeace(s, f, o, false);
        if (relation(s, f, o).stance !== 'war') delete mem.coalition![o];
        continue;
      }
      if (age < 6 || theirs.player) continue;
      const oldFoes = (f === 'choir' && o === 'hush') || (f === 'hush' && o === 'choir');
      const losing = them > me * (oldFoes ? 2 : 1.35) || lostTo(s, f, o, 6) >= 2;
      const idle = age > 12 && recentFighting(s, f, o, 8) === 0 && !bordering(s, f, o);
      const twoFronts = v.wars.length >= 2 && them < me * 0.8 && recentFighting(s, f, o, 5) === 0;
      const leaderElsewhere = v.leader && v.leader !== o;
      if (losing || idle || twoFronts || leaderElsewhere) suePeace(s, f, o, losing);
      continue;
    }
    // Late-game: the others band together against a runaway leader (the
    // landless Drift have nothing to defend and everything to lose by it).
    if (f !== 'drift' && v.leader === o && s.turn >= 50 && v.wars.length <= 1 && s.turn - rel.since > 5) {
      if (rel.stance === 'alliance') propose(s, { kind: 'breakAlliance', from: f, to: o });
      declareWar(s, f, o);
      continue;
    }
    // Opportunistic wars on weaker neighbours, in character.
    if (rel.stance === 'peace' && wantsWar(s, f, o, v, me, them)) {
      declareWar(s, f, o);
      continue;
    }
    if (theirs.player) continue;
    if (!rel.trade && rel.opinion > -30) propose(s, { kind: 'trade', from: f, to: o });
    // Alliances against a common enemy.
    if (rel.stance === 'peace' && rel.opinion > -15) {
      const common = FACTION_IDS.some((x) => x !== f && x !== o && s.factions[x].alive && atWar(s, f, x) && atWar(s, o, x));
      if (common && s.turn - rel.since > 2) propose(s, { kind: 'alliance', from: f, to: o });
    }
  }
}

/**
 * Ask for peace, and when losing, pay for it: the smallest purse (up to
 * half the treasury) that the other side would take.
 */
function suePeace(s: CampaignState, f: FactionId, o: FactionId, losing: boolean): void {
  const purse = s.factions[f].coin;
  for (const share of losing ? [0, 0.1, 0.2, 0.35, 0.5] : [0]) {
    const coin = Math.floor((purse * share) / 50) * 50;
    const deal: Deal = coin > 0 ? { kind: 'peace', from: f, to: o, coin } : { kind: 'peace', from: f, to: o };
    if (valueDeal(s, deal).value >= 0) {
      propose(s, deal);
      return;
    }
  }
  // No price was enough: ask anyway, they may soften.
  if (!losing) return;
  propose(s, { kind: 'peace', from: f, to: o });
}

/**
 * Deals put to the human player, sparingly and in character: peace when a
 * war with them goes badly, trade when relations are decent, an alliance
 * against a common enemy, tribute when we are far stronger. One offer every
 * few Tolls at most; nothing happens when no one is there to ask.
 */
async function offers(s: CampaignState, f: FactionId, v: View, ctx: AiContext): Promise<void> {
  const pl = s.player;
  if (!ctx.offer || pl === f || !s.factions[pl].alive || s.factions[pl].finalStage) return;
  if (overlordOf(s, f) === pl || overlordOf(s, pl) === f) return;
  const mem = memory(s, f);
  if (mem.lastOffer !== undefined && s.turn - mem.lastOffer < 4) return;
  const rel = relation(s, f, pl);
  const me = v.strength[f];
  const them = v.strength[pl];
  const oldFoes = (f === 'choir' && pl === 'hush') || (f === 'hush' && pl === 'choir');
  let deal: Deal | null = null;
  if (rel.stance === 'war') {
    const age = s.turn - rel.since;
    const held = mem.holdWar && mem.holdWar.target === pl && mem.holdWar.until > s.turn;
    const losing = them > me * (oldFoes ? 1.8 : 1.3) || lostTo(s, f, pl, 6) >= 2;
    const elsewhere = v.wars.length >= 2 && recentFighting(s, f, pl, 5) === 0;
    if (age >= 5 && !held && (losing || elsewhere || (v.leader && v.leader !== pl))) deal = { kind: 'peace', from: f, to: pl };
  } else if (!rel.trade && rel.opinion >= 0 && !oldFoes) {
    deal = { kind: 'trade', from: f, to: pl };
  } else if (rel.stance === 'peace' && rel.opinion >= 10 && FACTION_IDS.some((x) => x !== f && x !== pl && s.factions[x].alive && atWar(s, f, x) && atWar(s, pl, x))) {
    deal = { kind: 'alliance', from: f, to: pl };
  } else if (rel.stance === 'peace' && f !== 'vesperate' && me > them * 2.2 && rel.opinion < 10 && s.turn - rel.since > 8 && bordering(s, f, pl) && noise(s, `demand:${f}`) < 0.3) {
    const income = ledgerNet(factionLedger(s, pl)).coin;
    const coin = Math.min(250, Math.max(50, Math.round((income * 0.15) / 10) * 10));
    deal = { kind: 'tribute', from: f, to: pl, coin, demand: true };
  }
  if (!deal) return;
  mem.lastOffer = s.turn;
  await ctx.offer(deal);
}

function wantsWar(s: CampaignState, f: FactionId, o: FactionId, v: View, me: number, them: number): boolean {
  const rel = relation(s, f, o);
  if (s.turn < 14 || s.turn - rel.since < 10) return false;
  if (v.wars.length >= 2) return false;
  // The Drift raid free towns and trade with everyone: a war of choice only
  // brings every host down on their few sails.
  if (f === 'drift') return false;
  // The Drift hold no land: a war on them wins nothing but a hunt (the
  // coalition against their Great Moot is decided elsewhere).
  if (o === 'drift') return false;
  // The cautious Vesperate start no wars of choice in the early years.
  if (f === 'vesperate' && s.turn < 32) return false;
  // Balance of power: don't finish off a faction already losing a war to a
  // stronger third party; that only feeds the front-runner.
  const strongest = FACTION_IDS.filter((x) => x !== f && x !== o && s.factions[x].alive).sort((a, b) => v.strength[b] - v.strength[a])[0];
  if (strongest && atWar(s, o, strongest) && v.strength[strongest] > me && them < v.strength[strongest] * 0.6) return false;
  // Nor pile onto a much weaker faction already fighting someone else: two
  // on one ends factions, and a campaign is better with all four in it.
  const fighting = FACTION_IDS.some((x) => x !== o && x !== f && s.factions[x].alive && atWar(s, o, x));
  if (fighting && them < me * 0.6) return false;
  if (!bordering(s, f, o)) return false;
  const p = PERSONA[f];
  // Room to grow in peace keeps swords sheathed; a crowded map draws them.
  const room = freeRoom(s, f);
  let need = (room >= 3 ? 1.9 : room >= 1 ? 1.55 : 1.3) / p.warlike;
  // The balance of power: from the middle game a clear front-runner draws
  // wars from its neighbours, above all while it is busy with another war.
  const ranked = FACTION_IDS.filter((x) => s.factions[x].alive).sort((a, b) => v.strength[b] - v.strength[a]);
  if (s.turn >= 28 && ranked[0] === o && ranked[1] && them > v.strength[ranked[1]] * 1.25) {
    const busy = FACTION_IDS.some((x) => x !== f && x !== o && s.factions[x].alive && atWar(s, o, x));
    need = Math.min(need, (busy ? 0.7 : 0.9) / p.warlike);
  }
  // A new front must be affordable on top of the wars already fought.
  const enemies = v.wars.reduce((t, x) => t + v.strength[x], 0);
  if (me < (them + enemies) * need) return false;
  if (rel.opinion > 25) return false;
  const chance = 0.12 * p.warlike + (room === 0 ? 0.1 : 0);
  return noise(s, `war:${f}:${o}`) < chance;
}

// ---------------------------------------------------------------- mechanics

/** Faction abilities. The Drift's (tribute, moorings, migrations) happen on the march. */
function mechanics(s: CampaignState, f: FactionId, v: View): void {
  if (f === 'choir') choirMechanics(s, v);
  else if (f === 'hush') hushMechanics(s, v);
  else if (f === 'vesperate') vesperateMechanics(s, v);
}

function choirMechanics(s: CampaignState, v: View): void {
  const c = s.factions.choir;
  // Relight our Candles, then climb in pilgrimage: the Tilt must go sunward.
  for (const id of CANDLES) if (s.regions[id]!.owner === 'choir' && !s.regions[id]!.lit) relight(s, id);
  // The Last Lens: once begun, every rival marches on the Choir. Begin only
  // with Radiance and coin in hand to raise the stages back to back.
  const begun = c.lens >= 1;
  if (lensReady(s).ok && (begun || (c.res >= LENS_COST.res * 3 && c.coin >= LENS_COST.coin * 2 + v.reserve))) buildLensStage(s);
  const lensSoon = c.lens < 5 && CANDLES.every((x) => s.regions[x]!.owner === 'choir') && s.regions[NAIL_SPIRE]!.owner === 'choir';
  // With the Tilt already high enough, Radiance goes to the Lens, not more pilgrims.
  const lensKeep = s.tilt >= 3 && s.turn >= VICTORY_OPENS - 3 ? LENS_COST.res * Math.min(3, 5 - c.lens) : LENS_COST.res;
  const keep = lensSoon ? lensKeep : colossusDue(s, 'choir') && s.turn >= 20 ? 300 : 0;
  // Bread before glory: a hungry Choir sings the Harvest first.
  const hungry = (c.food < 60 && v.foodNet < 1) || (c.food < 150 && v.foodNet < -3);
  if (!c.hymn && hungry && c.res >= 120) singHymn(s, 'harvest');
  // Past +3 the pilgrims win nothing more: a blinding sky only scorches the fields.
  for (const id of s.tilt >= 4 ? [] : [NAIL_SPIRE, ...CANDLES]) {
    if (c.res - PILGRIMAGE_COST < keep) break;
    const r = s.regions[id]!;
    if (r.owner !== 'choir' || (r.ritualCooldown ?? 0) > 0) continue;
    pilgrimage(s, id);
  }
  if (!c.hymn) {
    const fighting = v.wars.length > 0 && s.reports.some((r) => r.turn >= s.turn - 2 && (r.attacker === 'choir' || r.defender === 'choir'));
    if (fighting && c.res >= 150 + keep + 60) singHymn(s, s.turn % 2 ? 'lens' : 'unbowed');
  }
  // Crusade: the strongest host marches on a Candle, the Spire or the Hush.
  if (c.zeal >= 60 && !s.armies.some((a) => a.crusade)) {
    const army = factionArmies(s, 'choir').sort((a, b) => armyPower(b) - armyPower(a))[0];
    const target = [...CANDLES, NAIL_SPIRE].find((x) => s.regions[x]!.owner !== 'choir' && (s.regions[x]!.owner === 'free' || atWar(s, 'choir', s.regions[x]!.owner as FactionId))) ?? ownedRegions(s, 'hush').find((r) => atWar(s, 'choir', 'hush') && r !== POLE);
    if (army && target && fill(army) > 0.5) crusade(s, army.id, target);
  }
}

function hushMechanics(s: CampaignState, v: View): void {
  const h = s.factions.hush;
  for (const c of CANDLES) if (s.regions[c]!.owner === 'hush' && s.regions[c]!.lit) extinguish(s, c);
  // The Listening: the Hush coin sink that drags the Tilt nightward. Patient:
  // early on the coin goes to the hunt, later the stones are heard every Toll.
  const sites = [POLE, ...CANDLES].filter((r) => s.regions[r]!.owner === 'hush' && !(s.regions[r]!.ritualCooldown ?? 0));
  const spare = [1600, 700, 300][v.phase]! + (v.urgent ? 600 : 0);
  let held = 0;
  for (const r of sites) {
    if (h.coin < 300 + v.reserve + spare + v.saving) break;
    if (v.phase === 0 && held >= 1) break;
    if (listen(s, r).ok) held++;
  }
}

function vesperateMechanics(s: CampaignState, v: View): void {
  const ves = s.factions.vesperate;
  // The Great Toll: keep the world near the Hour, above all while we hold for victory.
  const hold = ves.finalStage || victoryStatus(s, 'vesperate').lines.filter((l) => !l.ok).length <= 2;
  const drift = Math.abs(s.tilt);
  const pushingAway = s.tilt !== 0 && Math.sign(s.tiltProgress) === Math.sign(s.tilt) && Math.abs(s.tiltProgress) >= 40;
  // A Tilt of one either way does not trouble the Gloaming: let it be until the endgame.
  const late = s.turn >= VICTORY_OPENS - 5;
  const want = drift >= 2 || (drift === 1 && late && hold && pushingAway) || (drift === 0 && ves.finalStage && Math.abs(s.tiltProgress) >= 70);
  if (want && ves.greatTollCooldown === 0 && ves.coin >= GREAT_TOLL.coin + v.reserve * 0.5 && ves.res >= GREAT_TOLL.res) greatToll(s);
  // Keep the Houses content, and none too proud.
  for (const hId of ['carillon', 'lantern', 'weir'] as const) {
    if (ves.houses[hId] < 32 && ves.coin > 450 + v.reserve) giftHouse(s, hId);
  }
  planCalendar(s, v);
}

/** Plan the Observances ahead: order when towns riot, food when hungry, musters for war, markets otherwise. */
function planCalendar(s: CampaignState, v: View): void {
  const ves = s.factions.vesperate;
  const len = ves.calendar.length;
  const own = ownedRegions(s, 'vesperate');
  const unrest = own.filter((r) => s.regions[r]!.order < -6 || (s.regions[r]!.order < 2 && orderDelta(s, r) < 0)).length;
  const needs: ObservanceId[] = [];
  if (unrest >= 2) needs.push('vigil');
  if (ves.food < 40 && v.foodNet < 2) needs.push('harvest');
  const underfilled = factionArmies(s, 'vesperate').some((a) => fill(a) < 0.75) || factionArmies(s, 'vesperate').length < armyCap(s, 'vesperate');
  if ((v.wars.length || v.phase >= 1) && underfilled) needs.push('muster');
  if (unrest >= 4) needs.push('vigil');
  for (let k = 1; k < len; k++) {
    const slot = (s.turn + k) % len;
    const want = needs[k - 1] ?? 'market';
    if (ves.calendar[slot] !== want) setObservance(s, slot, want);
  }
}

// ------------------------------------------------------------------ economy

function economy(s: CampaignState, f: FactionId, v: View): void {
  if (f === 'drift') {
    driftEconomy(s, v);
    return;
  }
  orderCare(s, f, v);
  upgrades(s, f, v);
  wonder(s, f, v);
  buildings(s, f, v);
}

/** Lowest public order a region reaches over the next Tolls, with no army in it. */
function orderLow(s: CampaignState, f: FactionId, id: string, extra = 0, tolls = 6): number {
  const st = s.regions[id]!;
  const since = s.turn - st.takenTurn;
  const garrisoned = s.armies.some((a) => a.region === id && a.faction === f) ? 2 : 0;
  const base = orderDelta(s, id) - conquestUnrest(since) - garrisoned + extra;
  let o = st.order;
  let low = o;
  for (let k = 0; k < tolls; k++) {
    o = Math.max(-20, Math.min(20, o + base + conquestUnrest(since + k)));
    low = Math.min(low, o);
  }
  return low;
}

/** Order that buildings under way will add once finished. */
function pendingOrder(s: CampaignState, id: string): number {
  let t = 0;
  for (const sl of s.regions[id]!.slots) {
    if (!sl?.building) continue;
    const c = chainDef(sl.chain);
    t += (c.effects[sl.building.toLevel - 1]?.order ?? 0) - (sl.level > 0 ? (c.effects[sl.level - 1]?.order ?? 0) : 0);
  }
  return t;
}

const ORDER_KINDS: ChainKind[] = ['shrine', 'walls', 'special'];

/** Towns heading for revolt get an order building, or an army to sit in them. */
function orderCare(s: CampaignState, f: FactionId, v: View): void {
  const fs = s.factions[f];
  for (const id of ownedRegions(s, f)) {
    if (!regionDef(id).settlement) continue;
    const r = s.regions[id]!;
    if (r.slots.some((x) => x?.building) || orderLow(s, f, id) > -15) continue;
    let best: { slot: number; opt: BuildOption; gain: number } | null = null;
    for (let i = 0; i < r.slots.length; i++) {
      for (const o of buildOptions(s, id, i)) {
        if (!o.ok || !ORDER_KINDS.includes(o.chain.kind)) continue;
        const e = o.chain.effects[o.level - 1]!;
        const prev = o.level > 1 ? o.chain.effects[o.level - 2]! : {};
        const gain = (e.order ?? 0) - (prev.order ?? 0);
        if (gain <= 0 || fs.coin - o.cost < 100) continue;
        if (!best || gain / o.cost > best.gain / best.opt.cost) best = { slot: i, opt: o, gain };
      }
    }
    if (best && build(s, id, best.slot, best.opt.chain.id).ok) {
      v.needGarrison.delete(id);
      continue;
    }
    // Every plot taken and nothing to upgrade: make room for a shrine.
    const swap = replaceWeak(s, f, v, id, true);
    if (swap && fs.coin - swap.cost >= 100) {
      demolish(s, id, swap.slot);
      if (build(s, id, swap.slot, swap.chain.id).ok) v.needGarrison.delete(id);
    }
  }
}

function upgrades(s: CampaignState, f: FactionId, v: View): void {
  const fs = s.factions[f];
  const regions = ownedRegions(s, f).sort((a, b) => upgradeRank(s, b, v) - upgradeRank(s, a, v));
  for (const id of regions) {
    const ok = canUpgradeSettlement(s, id);
    if (!ok.ok) continue;
    if (fs.coin - ok.cost < v.reserve + (id === v.capital ? 0 : v.saving)) continue;
    // Bigger cities are harder to keep in order: only when order can take
    // it, now and in the long run (or there is a plot left for a shrine).
    if (orderLow(s, f, id, -1) <= -12) continue;
    const st = s.regions[id]!;
    const garrisoned = s.armies.some((a) => a.region === id && a.faction === f) ? 2 : 0;
    const longRun = orderDelta(s, id) - conquestUnrest(s.turn - st.takenTurn) - garrisoned;
    if (longRun < 1 && st.order < 14 && !st.slots.some((x) => !x)) continue;
    // A bigger town eats more: not while bread is short, unless it feeds itself.
    if (foodWorthOf(s, f, v) >= 40 && foodIfOurs(s, f, id) + farmFood(s, id) < 1) continue;
    upgradeSettlement(s, id);
  }
}

function upgradeRank(s: CampaignState, id: string, v: View): number {
  return (id === v.capital ? 10 : 0) + (regionDef(id).major ? 5 : 0) - s.regions[id]!.level;
}

const WONDER_TURN: Record<FactionId, number> = { choir: 10, hush: 12, vesperate: 24, drift: 30 };

/** The wonder: the Nail Forge and the Mother's Hollow push the Tilt; all of them raise a colossus. */
function wonder(s: CampaignState, f: FactionId, v: View): void {
  const fs = s.factions[f];
  if (s.turn < WONDER_TURN[f]) return;
  const chain = factionChains(f).find((c) => c.kind === 'wonder');
  if (!chain) return;
  if (ownedRegions(s, f).some((r) => s.regions[r]!.slots.some((x) => x && x.chain === chain.id))) return;
  if (fs.coin < chain.costs[0]! + v.reserve * 0.5) return;
  const sites = ownedRegions(s, f)
    .filter((r) => regionDef(r).major && s.regions[r]!.level >= (chain.minLevel ?? 1))
    .sort((a, b) => Number(b === v.capital) - Number(a === v.capital) || (v.threat[a] ?? 0) - (v.threat[b] ?? 0));
  for (const id of sites) {
    const r = s.regions[id]!;
    if (r.slots.some((x) => x?.building)) continue;
    const slot = r.slots.findIndex((x) => !x);
    if (slot < 0) continue;
    if (build(s, id, slot, chain.id).ok) return;
  }
}

function wonderSlotKept(s: CampaignState, f: FactionId, id: string, v: View): boolean {
  // Keep the capital's last free slot for the wonder until it stands.
  if (id !== v.capital || s.turn < WONDER_TURN[f] - 6) return false;
  const chain = factionChains(f).find((c) => c.kind === 'wonder');
  if (!chain) return false;
  if (ownedRegions(s, f).some((r) => s.regions[r]!.slots.some((x) => x && x.chain === chain.id))) return false;
  return s.regions[id]!.slots.filter((x) => !x).length <= 1 && s.regions[id]!.level >= (chain.minLevel ?? 1);
}

const RECRUIT_KINDS: ChainKind[] = ['barracks', 'range', 'stables', 'foundry', 'kites'];

/** Towns that train the line worth keeping: one, and another for every three hosts. */
function hubsWanted(s: CampaignState, f: FactionId): number {
  return Math.min(3, 1 + Math.floor(factionArmies(s, f).length / 3));
}

/** A town fit to become a new recruiting town: no other one near, and big enough. */
function freshHub(s: CampaignState, f: FactionId, v: View, id: string): boolean {
  if (v.hubs.length >= hubsWanted(s, f) || v.nearHub.has(id)) return false;
  return id === v.capital || regionDef(id).major || s.regions[id]!.level >= 3 || v.hubs.length === 0;
}

/** Build what pays best for its price, one project per town per Toll. */
function buildings(s: CampaignState, f: FactionId, v: View): void {
  const fs = s.factions[f];
  // A share of the treasury is kept for troops while the armies are thin or
  // few: small early on (the economy comes first), most of it later.
  const armies = factionArmies(s, f);
  const wantTroops = armies.length < Math.min(armyCap(s, f), 2 + v.phase) || armies.some((a) => fill(a) < 0.75);
  const share = (v.urgent ? 1 : wantTroops ? [0.35, 0.55, 0.7][v.phase]! + (v.wars.length ? 0.15 : 0) : 0) * (v.focus?.kind === 'economy' ? 0.4 : 1);
  // Only keep what troops could actually use: no point saving for men we cannot feed.
  const mouths = Math.max(0, (v.foodNet - foodFloor(fs.food)) / 0.5);
  const troopCoin = mouths < 2 ? 0 : Math.min(4000, mouths * 850);
  const keepForTroops = share * Math.min(Math.max(0, fs.coin - v.reserve), troopCoin);
  const picks: { id: string; slot: number; opt: BuildOption; score: number }[] = [];
  for (const id of ownedRegions(s, f)) {
    const r = s.regions[id]!;
    if (!regionDef(id).settlement || r.slots.some((x) => x?.building)) continue;
    let best: { id: string; slot: number; opt: BuildOption; score: number } | null = null;
    for (let i = 0; i < r.slots.length; i++) {
      if (!r.slots[i] && wonderSlotKept(s, f, id, v)) continue;
      for (const o of buildOptions(s, id, i)) {
        if (!o.ok || o.chain.kind === 'wonder') continue;
        const sc = buildScore(s, f, v, id, o);
        if (sc > 0 && (!best || sc > best.score)) best = { id, slot: i, opt: o, score: sc };
      }
    }
    if (best) picks.push(best);
  }
  picks.sort((a, b) => b.score - a.score);
  for (const p of picks) {
    // A new recruiting town built this Toll changes what the next one is worth.
    const score = isLine(p.opt.chain.kind) && !v.hubs.includes(p.id) ? buildScore(s, f, v, p.id, p.opt) : p.score;
    if (score <= 0) continue;
    const floor = v.reserve + (score >= 25 ? 0 : v.saving) + (score >= 12 ? 0 : keepForTroops);
    if (fs.coin - p.opt.cost < floor) continue;
    if (fs.res < p.opt.resCost) continue;
    if (build(s, p.id, p.slot, p.opt.chain.id).ok && isLine(p.opt.chain.kind)) addHub(v, p.id);
  }
  // Towns with every plot built: swap a weak building for bread, order or a
  // recruiting town when those run short. The best-placed towns go first.
  const towns = ownedRegions(s, f).filter((id) => regionDef(id).settlement);
  towns.sort((a, b) => (b === v.capital ? 1 : 0) - (a === v.capital ? 1 : 0) || (regionDef(b).major ? 1 : 0) - (regionDef(a).major ? 1 : 0) || s.regions[b]!.level - s.regions[a]!.level);
  for (const id of towns) {
    const swap = replaceWeak(s, f, v, id, false);
    if (swap && fs.coin - swap.cost >= v.reserve) {
      demolish(s, id, swap.slot);
      if (build(s, id, swap.slot, swap.chain.id).ok && isLine(swap.chain.kind)) addHub(v, id);
    }
  }
}

function isLine(k: ChainKind): boolean {
  return k === 'barracks' || k === 'range';
}

/** Note a new recruiting town in the view, so the next choice this Toll sees it. */
function addHub(v: View, id: string): void {
  if (v.hubs.includes(id)) return;
  v.hubs.push(id);
  const steps = stepsFrom(id);
  for (const n in steps) if (steps[n]! <= 2) v.nearHub.add(n);
}

/**
 * A town with every plot built: the weakest building that a farm (when
 * food binds) or an order building (when the town grows unruly) would
 * clearly beat, even counting what the old one cost.
 */
function replaceWeak(s: CampaignState, f: FactionId, v: View, id: string, orderOnly: boolean): { slot: number; chain: ChainDef; cost: number } | null {
  const r = s.regions[id]!;
  if (r.slots.some((x) => !x || x.building)) return null;
  const needFood = !orderOnly && foodWorthOf(s, f, v) >= 28;
  const needOrder = orderLow(s, f, id, 0, 10) <= -10;
  // No town left that trains the line (or too few for a rich realm's hosts): make one.
  const needHub = !orderOnly && freshHub(s, f, v, id) && (v.hubs.length === 0 || s.factions[f].coin > 6000);
  if (!needFood && !needOrder && !needHub) return null;
  let best: { slot: number; chain: ChainDef; cost: number; gain: number } | null = null;
  for (let i = 0; i < r.slots.length; i++) {
    const cur = r.slots[i]!;
    const c = chainDef(cur.chain);
    if (c.kind === 'wonder' || (id === v.capital && RECRUIT_KINDS.includes(c.kind))) continue;
    // Never pull down the last recruiting towns a realm needs.
    if (isLine(c.kind) && v.hubs.length <= hubsWanted(s, f)) continue;
    if (c.kind === 'walls' && (v.threat[id] ?? 0) > 0) continue;
    const old = effectWorth(s, f, v, id, c, cur.level, 0);
    r.slots[i] = null;
    const opts = buildOptions(s, id, i).filter((o) => {
      if (!o.ok || o.chain.id === c.id || o.chain.kind === 'wonder') return false;
      const e = o.chain.effects[0]!;
      return (needFood && (e.food ?? 0) > 0) || (needOrder && (e.order ?? 0) > 0) || (needHub && isLine(o.chain.kind));
    });
    r.slots[i] = cur;
    for (const o of opts) {
      const gain = effectWorth(s, f, v, id, o.chain, 1, 0) - old * (needHub && isLine(o.chain.kind) ? 1.1 : 1.6) - 6;
      if (gain > 0 && (!best || gain > best.gain)) best = { slot: i, chain: o.chain, cost: o.cost, gain };
    }
  }
  return best;
}

function isHub(s: CampaignState, f: FactionId, id: string, v: View): number {
  if (id === v.capital) return 1;
  const r = s.regions[id]!;
  if (regionDef(id).major) return 0.7;
  const front = neighbors(id).some((n) => {
    const o = s.regions[n]!.owner;
    return o !== f && (o === 'free' || atWar(s, f, o));
  });
  return r.level >= 2 && front ? 0.35 : 0.12;
}

/**
 * Worth of a building per 100 coin spent: everything it gives is turned
 * into coin-equivalents per Toll (food, order and the faction resource
 * priced by how badly we need them), divided by its price.
 */
function buildScore(s: CampaignState, f: FactionId, v: View, id: string, o: BuildOption): number {
  const u = effectWorth(s, f, v, id, o.chain, o.level, o.level - 1);
  return (u * 100) / Math.max(1, o.cost + o.resCost * RES_WORTH[f] * 10);
}

/** Food is dear when short, and when coin waits on bread for more troops. */
function foodWorthOf(s: CampaignState, f: FactionId, v: View): number {
  const fs = s.factions[f];
  const hungry = fs.food < 40 || v.foodNet < 2;
  const armies = factionArmies(s, f);
  const foodBound = fs.coin > 1500 && v.foodNet < 5 && (armies.some((a) => fill(a) < 0.8) || armies.length < armyCap(s, f));
  return hungry ? 40 : foodBound ? 28 : fs.food > 300 && v.foodNet > 5 ? 2 : 10;
}

/** What going from one level of a chain to another gives each Toll, in coin-equivalents. */
function effectWorth(s: CampaignState, f: FactionId, v: View, id: string, c: ChainDef, level: number, from: number): number {
  const e = c.effects[level - 1]!;
  const prev = from > 0 ? c.effects[from - 1]! : {};
  const d = (k: 'coin' | 'food' | 'order' | 'growth' | 'res' | 'replenish' | 'walls' | 'garrison' | 'herdFood' | 'rank' | 'recruitPct' | 'vision') => ((e[k] as number | undefined) ?? 0) - ((prev[k] as number | undefined) ?? 0);
  const band = bandIndex(s, id);
  const hub = isHub(s, f, id, v);
  let u = d('coin');
  const foodWorth = foodWorthOf(s, f, v);
  const farmMult = f === 'hush' ? 1 : [0.25, 0.6, 1.3, 1, 0.25][band]!;
  u += d('food') * farmMult * foodWorth;
  if (f === 'hush' && d('herdFood') > 0) {
    const herds = [id, ...neighbors(id)].reduce((t, n) => t + herdIn(s, n), 0);
    u += d('herdFood') * Math.min(4, herds) * 0.6 * foodWorth;
  }
  u += d('growth') * (s.regions[id]!.level < (regionDef(id).major ? 4 : 3) ? 12 : 1);
  const low = orderLow(s, f, id);
  u += d('order') * (low <= -12 ? 40 : low <= -4 ? 15 : low <= 4 ? 6 : 2);
  const towerDark = c.kind === 'tower' && f === 'choir' && band <= 1 && regionDef(id).landmark !== 'candle';
  if (!towerDark) u += d('res') * RES_WORTH[f];
  const frontier = (v.threat[id] ?? 0) > 0 || neighbors(id).some((n) => {
    const ow = s.regions[n]!.owner;
    return ow !== f && ow !== 'free' && atWar(s, f, ow);
  });
  u += d('replenish') * (frontier ? 3 : 1) * (hub >= 0.7 ? 1.5 : 1);
  const pressed = (v.threat[id] ?? 0) > defenseOf(s, f, id) * 0.5;
  const wallNeed = pressed ? 1 : frontier ? 0.45 : id === v.capital ? 0.35 : (v.bonus[id] ?? 0) > 2 ? 0.3 : 0.05;
  u += (d('walls') * 40 + d('garrison') * 25) * wallNeed;
  if (RECRUIT_KINDS.includes(c.kind) || (c.kind === 'shrine' && level >= 2 && from < 2)) {
    const tierUnlock = s.regions[id]!.level >= level ? 1 : 0.3;
    const kindWorth = ({ barracks: 30, range: 30, stables: 22, foundry: 18, kites: 16 } as Record<string, number>)[c.kind] ?? 10;
    // A second copy of a chain elsewhere helps less than the first, unless
    // the realm wants another recruiting town away from the old ones.
    const have = Math.max(0, ...ownedRegions(s, f).filter((r) => r !== id).map((r) => chainLevel(s.regions[r]!, c.kind)));
    const fresh = isLine(c.kind) && freshHub(s, f, v, id);
    const dup = fresh ? 1 : have >= level ? 0.35 : 1;
    // With nowhere left to train the line, nothing matters more.
    const none = fresh && v.hubs.length === 0 ? 3 : 1;
    // Rich but short of bread: better troops, not more of them.
    const quality = s.factions[f].coin > 5000 && foodWorthOf(s, f, v) >= 28 ? 2.5 : 1;
    u += kindWorth * (fresh ? Math.max(hub, 0.7) : hub) * tierUnlock * dup * none * quality * [0.8, 1.4, 1.6][v.phase]! * (level - from);
  }
  if (e.bellRange && !prev.bellRange) u += frontier ? 12 : 4;
  if (e.canal && !prev.canal) u += 8;
  u += d('rank') * 12 * hub;
  u += d('recruitPct') * 0.5 * hub;
  u += d('vision');
  return u;
}

// ------------------------------------------------------------- Drift cities

function driftEconomy(s: CampaignState, v: View): void {
  const d = s.factions.drift;
  const order: ChainKind[] = ['market', 'shrine', 'farm', 'range', 'barracks', 'stables', 'kites', 'sails', 'foundry'];
  const hasLoft = s.armies.some((a) => a.city?.slots.some((x) => x && chainDef(x.chain).kind === 'wonder'));
  for (const a of factionArmies(s, 'drift').sort((x, y) => armyPower(y) - armyPower(x))) {
    if (!a.city) continue;
    const renownFor = a.city.level === 1 ? 100 : 300;
    if (a.city.level < 3 && d.res >= renownFor && d.coin >= CITY_COST[a.city.level]! + v.reserve + 400) upgradeCity(s, a.id);
    if (a.city.slots.some((x) => x?.building)) continue;
    let best: { slot: number; chain: string; score: number; cost: number } | null = null;
    for (let i = 0; i < a.city.slots.length; i++) {
      for (const o of cityBuildOptions(s, a.id, i)) {
        if (!o.ok) continue;
        let score: number;
        if (o.chain.kind === 'wonder') score = hasLoft || s.turn < WONDER_TURN.drift ? -1 : 30;
        else {
          const k = order.indexOf(o.chain.kind);
          score = (k < 0 ? 1 : 12 - k) + (a.city.slots[i] ? 2 - o.level : 0);
          if (o.chain.kind === 'farm' && (d.food > 60 || v.foodNet > 3)) score -= 6;
          if (o.chain.kind === 'sails') score -= 2;
        }
        if (score > 0 && (!best || score > best.score)) best = { slot: i, chain: o.chain.id, score, cost: o.cost };
      }
    }
    if (best && d.coin - best.cost >= v.reserve + (best.score >= 30 ? 0 : 300 + v.saving)) cityBuild(s, a.id, best.slot, best.chain);
  }
}

// -------------------------------------------------------------- recruitment

/** Coin and food left to spend on troops this Toll, shared by every army. */
interface Purse {
  net: number;
  food: number;
}

function recruitment(s: CampaignState, f: FactionId, v: View): void {
  const purse: Purse = { net: v.net, food: v.foodNet };
  const armies = factionArmies(s, f).sort((a, b) => armyPower(b) - armyPower(a));
  // Vesperate musters are cheaper: hold back routine recruiting for them.
  const muster = f === 'vesperate' && currentObservance(s) === 'muster';
  const cal = s.factions.vesperate.calendar;
  const musterSoon = f === 'vesperate' && !muster && !v.urgent && [1, 2].some((k) => cal[(s.turn + k) % cal.length] === 'muster');
  for (const a of armies) {
    if (!recruitSite(s, a)) continue;
    if (musterSoon && fill(a) >= 0.5) continue;
    fillArmy(s, f, a, v, purse, muster ? 0.6 : 1);
    // Equip the lord for the bands the army is heading into.
    equipLord(s, f, a, v);
  }
  raiseArmies(s, f, v, purse);
  upgradeUnits(s, f, v, purse);
}

/**
 * Rich, but out of bread or banners for more troops: trade cheap units for
 * better ones where the army stands at a recruiting town. Coin becomes
 * strength without more mouths to feed.
 */
function upgradeUnits(s: CampaignState, f: FactionId, v: View, purse: Purse): void {
  const fs = s.factions[f];
  if (fs.coin < 5000 + v.reserve + v.saving) return;
  const armies = factionArmies(s, f);
  const capped = armies.length >= armyCap(s, f) || purse.food - 4.5 < foodFloor(fs.food);
  if (!capped) return;
  let swaps = 0;
  for (const a of armies.sort((x, y) => armyPower(y) - armyPower(x))) {
    if (a.units.length < 8 || !recruitSite(s, a)) continue;
    while (swaps < 4 && fs.coin > 4000 + v.reserve) {
      // The cheapest unit in the army.
      let worst = -1;
      for (let i = 0; i < a.units.length; i++) {
        const d = unitDef(a.units[i]!.def);
        if (d.category === 'colossus' || d.category === 'character') continue;
        if (worst < 0 || d.cost < unitDef(a.units[worst]!.def).cost) worst = i;
      }
      if (worst < 0) break;
      const old = unitDef(a.units[worst]!.def);
      const better = recruitOptions(s, a.id).filter((o) => o.def.id !== old.id && o.coin + 400 <= fs.coin - v.reserve && (o.res === 0 || o.res + (f === 'choir' ? 250 : 0) <= fs.res) &&o.def.cost >= old.cost * 1.35 && o.def.category !== 'colossus');
      // Recruit options are checked with the army full: compute them as if the slot were free.
      const cands = better.filter((o) => o.ok || o.reason === 'The army is full (16 units)');
      if (!cands.length) break;
      const sameRole = cands.filter((o) => o.def.role === old.role);
      const pool = (sameRole.length ? sameRole : cands).sort((x, y) => y.def.tier - x.def.tier || y.def.cost - x.def.cost);
      const pick = pool[0]!;
      const upkeepAdd = Math.round((pick.def.cost - old.cost) * 0.05);
      if (purse.net - upkeepAdd < (v.wars.length ? -fs.coin / 30 : 0)) break;
      disband(s, a.id, worst);
      if (!recruit(s, a.id, pick.def.id).ok) break;
      purse.net -= upkeepAdd;
      swaps++;
    }
  }
}

/** Food a new recruit will eat each Toll, where this army usually stands. */
function rationOf(s: CampaignState, f: FactionId, a: ArmyState): number {
  if (f === 'drift') return regionDef(a.region).galeRoad || s.regions[a.region]!.mooring ? 0.15 : 0.35;
  if (f === 'hush' && herdIn(s, a.region) > 0) return 0.3;
  return 0.5;
}

/**
 * The food deficit per Toll the granary can carry: none when it is thin, a
 * little more the fuller it is (it holds 400 at most, so a full one should
 * be eaten into).
 */
function foodFloor(stock: number): number {
  return stock < 30 ? 0 : stock < 100 ? -0.5 : stock < 200 ? -2 : -stock / 45;
}

/** Recruit into an army while coin, upkeep and food allow. */
function fillArmy(s: CampaignState, f: FactionId, a: ArmyState, v: View, purse: Purse, reserveMult = 1): void {
  const fs = s.factions[f];
  let guard = 0;
  while (a.units.length < MAX_UNITS && guard++ < 16) {
    const budget = fs.coin - v.reserve * reserveMult - v.saving;
    // Upkeep must stay payable: in peace keep a surplus, in war spend down slowly.
    const floorNet = v.urgent ? -fs.coin / 12 : v.wars.length ? -fs.coin / 25 : 20;
    // And the army must be fed.
    const floorFood = foodFloor(fs.food);
    const eat = rationOf(s, f, a);
    if (purse.food - eat < floorFood) break;
    const opts = recruitOptions(s, a.id).filter((o) => o.ok && o.coin <= (o.def.category === 'colossus' ? fs.coin - v.reserve : budget));
    if (!opts.length) break;
    const pick = pickUnit(s, f, a, opts.map((o) => o.def.id), v);
    if (!pick) break;
    const upkeepAdd = Math.round(unitDef(pick).cost * 0.05 * (1 + 0.05 * a.units.filter((u) => u.def === pick).length));
    if (purse.net - upkeepAdd < floorNet) break;
    if (!recruit(s, a.id, pick).ok) break;
    purse.net -= upkeepAdd;
    purse.food -= eat;
  }
}

function equipLord(s: CampaignState, f: FactionId, a: ArmyState, v: View): void {
  const fs = s.factions[f];
  if (fs.coin < 1200 + v.reserve + v.saving || !recruitSite(s, a)) return;
  const target = memory(s, f).orders?.[a.id] ?? a.region;
  const band = bandIndex(s, target);
  for (const t of Object.keys(TRAITS)) {
    const def = TRAITS[t]!;
    if (def.faction !== f || a.lord.traits.includes(t)) continue;
    const useful = (t === 'lampBearer' && band <= 1) || (t === 'veil' && band >= 3) || ((t === 'provisioned' || t === 'stormCloaks') && (band === 0 || band === 4)) || fs.coin > 5000;
    if (useful) buyTrait(s, a.id, t);
  }
}

function raiseArmies(s: CampaignState, f: FactionId, v: View, purse: Purse): void {
  const fs = s.factions[f];
  const armies = factionArmies(s, f);
  if (armies.length >= armyCap(s, f)) return;
  // A new host must be fed and paid for: room for at least eight mouths
  // (a sail on the Gale Roads eats far less than a marching host).
  if (armies.length > 0 && purse.food - (f === 'drift' ? 2 : 4.5) < foodFloor(fs.food)) return;
  const spare = fs.coin - v.saving;
  const rich = spare > 4500;
  const filled = armies.every((a) => fill(a) >= 0.7);
  // The Drift need more sails for the Great Moot than their purse suggests; new sails start small.
  const sailsWanted = f === 'drift' && armies.length < 3 && filled && spare > RAISE_COST + 900 + v.reserve && purse.net > 80;
  // A treasury this deep raises hosts even while an old one is still refilling.
  const veryRich = spare > 9000;
  const needMore = armies.length === 0 || sailsWanted || (v.urgent && fs.coin > 2200 && purse.net > -100) || (filled && spare > RAISE_COST + 2200 + v.reserve && purse.net > 120) || (rich && (filled || veryRich) && purse.net > -50);
  if (!needMore) return;
  const site = raiseSite(s, f, v);
  if (!site) return;
  const r = raiseArmy(s, f, site);
  if (!r.ok) return;
  purse.net -= Math.round(unitDef(r.army.lord.def).cost * 0.05);
  purse.food -= 0.5;
  fillArmy(s, f, r.army, v, purse);
}

function raiseSite(s: CampaignState, f: FactionId, v: View): string | null {
  if (f === 'drift') {
    // A new sail is raised on the Gale Roads or at a mooring, where another sail can see it off.
    const spots = [KITE_FIELDS, ...GALE_ROAD, ...REGIONS.filter((r) => s.regions[r.id]!.mooring).map((r) => r.id)];
    const safe = spots.filter((id) => canRaiseArmy(s, 'drift', id).ok && !hostileArmiesIn(s, id, 'drift').length && (v.threat[id] ?? 0) < 3000);
    const withSail = safe.find((id) => s.armies.some((a) => a.faction === 'drift' && a.region === id));
    return withSail ?? safe[0] ?? null;
  }
  const own = ownedRegions(s, f).filter((r) => canRaiseArmy(s, f, r).ok);
  own.sort((a, b) => siteQuality(s, b) - siteQuality(s, a) || (v.threat[b] ?? 0) - (v.threat[a] ?? 0));
  return own[0] ?? null;
}

function siteQuality(s: CampaignState, id: string): number {
  const r = s.regions[id]!;
  let q = r.level;
  for (const k of RECRUIT_KINDS) q += chainLevel(r, k) * 1.5;
  return q;
}

/** Pick a unit to fill the army toward its doctrine's mix. */
function pickUnit(s: CampaignState, f: FactionId, a: ArmyState, ids: string[], v: View): string | null {
  const want = DOCTRINE[f];
  const fs = s.factions[f];
  const n = a.units.length + 1;
  const have: Record<string, number> = {};
  for (const u of a.units) {
    const r = unitDef(u.def).role;
    have[r] = (have[r] ?? 0) + 1;
  }
  let best: string | null = null;
  let bs = -Infinity;
  for (const id of ids) {
    const d = unitDef(id);
    if (d.category === 'colossus') {
      // The colossus walks with the strongest host, when we can spare it.
      if (fs.coin < d.cost + v.reserve + 800) continue;
      const score = 40;
      if (score > bs) {
        bs = score;
        best = id;
      }
      continue;
    }
    // Radiance goes to the Tilt first; only spend it on beams when there is plenty.
    if (f === 'choir' && (d.missile?.lightScaled || d.missile?.trajectory === 'beam' || d.missile?.trajectory === 'lineBeam') && fs.res < 320) continue;
    const share = (want[d.role] ?? 0.3) / 16;
    const deficit = share * n - (have[d.role] ?? 0);
    const dup = a.units.filter((u) => u.def === id).length;
    let score = deficit * 3 + d.tier * 0.75 - dup * 0.9 + noise(s, `${a.id}:${id}:${a.units.length}`) * 0.4;
    // Short of coin: favour cheap troops.
    if (fs.coin < 2500) score -= (d.cost / 1000) * 0.8;
    if (score > bs) {
      bs = score;
      best = id;
    }
  }
  return best;
}

// ----------------------------------------------------------------- military

interface Target {
  region: string;
  /** Assault a settlement, fight an army in the field, or (Drift) demand tribute. */
  kind: 'assault' | 'field' | 'tribute';
  enemy: Owner;
  /** Effective defending power. */
  need: number;
  value: number;
}

function targetsFor(s: CampaignState, f: FactionId, v: View): Target[] {
  const out: Target[] = [];
  for (const r of REGIONS) {
    const id = r.id;
    const st = s.regions[id]!;
    const foes = hostileArmiesIn(s, id, f);
    const hs = hostileSettlement(s, id, f);
    if (!foes.length && !hs) continue;
    const band = bandIndex(s, id);
    if (foes.length) {
      const defFaction = foes[0]!.faction;
      const defArmies = foes.filter((e) => e.faction === defFaction);
      const garrison = !!r.settlement && st.owner === defFaction;
      let need = sidePower(defArmies) * edgeOf(s, defFaction, id, f, defArmies[0]!) * (garrison ? 1 + wallLevel(s, id) * 0.1 : 1);
      if (garrison) need += garrisonEff(s, id) * edgeOf(s, defFaction, id, f, null);
      // Beating an army that threatens our land is worth a good deal.
      const menace = ownedRegions(s, f).some((o) => o === id || neighbors(o).includes(id)) ? 2.5 : 0.5;
      let value = 1.5 + menace + sidePower(defArmies) / 4000;
      if (garrison) value += regionValue(s, f, id, v);
      else value += (v.bonus[id] ?? 0) * 0.6 + (v.focus?.kind === 'war' && v.focus.target === defFaction ? 2 : 0);
      if (f === 'drift') value *= garrison ? 0.6 : 0.8;
      out.push({ region: id, kind: garrison ? 'assault' : 'field', enemy: defFaction, need, value });
      continue;
    }
    // A hostile settlement with no army in it.
    const need = garrisonEff(s, id) * EDGE[st.owner === 'free' ? st.culture : st.owner][band]!;
    let value: number;
    if (f === 'drift') {
      if (st.owner === 'free') {
        value = 2 + RESOURCES[r.resource].coin / 30 + (r.galeRoad ? 4 : 0) + (neighbors(id).some((n) => regionDef(n).galeRoad) ? 0.5 : 0);
        out.push({ region: id, kind: 'tribute', enemy: 'free', need, value });
        continue;
      }
      value = 1.5 + st.level * 0.6;
    } else value = regionValue(s, f, id, v);
    out.push({ region: id, kind: 'assault', enemy: st.owner, need, value });
  }
  return out;
}

interface Option {
  a: ArmyState;
  t: Target;
  score: number;
  /** Movement points to get there (Infinity if cannot). */
  cost: number;
  now: boolean;
}

/** Route to a region; the Hush count the Shadow Roads between the Umbral Vales. */
function route(s: CampaignState, a: ArmyState, to: string): { cost: number; step: string } | null {
  if (a.region === to) return { cost: 0, step: to };
  if (a.faction !== 'hush') {
    const p = findPath(s, a, to);
    if (!p || !p.length) return null;
    return { cost: p[p.length - 1]!.cost, step: to };
  }
  // Dijkstra with vale-to-vale jumps (a jump ends the march: count a full Toll).
  const dist: Record<string, number> = { [a.region]: 0 };
  const prev: Record<string, string> = {};
  const jump: Record<string, boolean> = {};
  const open = [a.region];
  const done = new Set<string>();
  while (open.length) {
    open.sort((x, y) => dist[x]! - dist[y]!);
    const c = open.shift()!;
    if (done.has(c)) continue;
    done.add(c);
    if (c === to) break;
    if (c !== a.region && blocksPath(s, a, c)) continue;
    const edges: [string, number, boolean][] = neighbors(c).map((n) => [n, stepCost(s, a, c, n), false]);
    if (regionDef(c).vale) for (const vv of VALES) if (vv !== c && !neighbors(c).includes(vv)) edges.push([vv, 100, true]);
    for (const [n, w, j] of edges) {
      const nd = dist[c]! + w;
      if (dist[n] === undefined || nd < dist[n]!) {
        dist[n] = nd;
        prev[n] = c;
        jump[n] = j;
        open.push(n);
      }
    }
  }
  if (dist[to] === undefined) return null;
  // First leg: up to the first jump.
  const chain: string[] = [];
  let c = to;
  while (c !== a.region) {
    chain.unshift(c);
    c = prev[c]!;
  }
  let step = to;
  for (let i = 0; i < chain.length; i++) {
    if (jump[chain[i]!]) {
      step = i === 0 ? chain[0]! : chain[i - 1]!;
      break;
    }
  }
  return { cost: dist[to]!, step };
}

/** Where a march along the route stops this Toll. */
function marchEnd(s: CampaignState, a: ArmyState, to: string): string {
  const p = findPath(s, a, to);
  if (!p) return a.region;
  let end = a.region;
  for (const st of p) {
    if (st.cost > a.moves + 0.001) break;
    end = st.region;
  }
  return end;
}

function rate(s: CampaignState, f: FactionId, v: View, a: ArmyState, t: Target, orders: Record<string, string>): Option | null {
  const rt = route(s, a, t.region);
  if (!rt) return null;
  if (strandsOnFields(s, a, rt.step)) return null;
  const mm = maxMoves(a);
  const tolls = rt.cost <= a.moves ? 0 : Math.ceil((rt.cost - a.moves) / mm);
  // A rival about to win: march from afar and fight at worse odds (losing a
  // battle costs less than losing the campaign), again and again.
  const deny = v.deny[t.region] ?? 0;
  if (tolls > (deny >= 7 ? 6 : 3)) return null;
  const now = tolls === 0;
  const mine = armyPower(a) * edgeOf(s, f, t.region, t.enemy, a);
  const urgency = urgencyOf(deny);
  // The late game rewards boldness: stalemates end in someone's victory.
  const late = (v.phase === 2 ? 0.9 : 1) * (v.focus?.kind === 'defend' || v.focus?.kind === 'economy' ? 1.15 : 1);
  if (v.focus?.kind === 'defend' && tolls > 1 && deny < 7) return null;
  const nerve = PERSONA[f].nerve * (t.kind === 'field' ? 1 : 0.95) * (a.lord.legendary ? 1.05 : 1) * urgency * late;
  let ratio = mine / Math.max(1, t.need);
  if (t.kind === 'tribute') {
    // Tribute needs twice the garrison's raw strength; otherwise an assault that frees the town.
    const tribute = armyPower(a) >= garrisonPower(s, t.region) * 2;
    ratio = tribute ? Math.max(ratio, 2) : ratio;
  }
  // A town we just failed to take needs a clearly stronger try.
  const burned = s.reports.some((r) => r.turn >= s.turn - 2 && r.region === t.region && r.attacker === f && r.winner !== f);
  const needed = nerve * (burned && deny < 7 ? 1.35 : 1);
  // Against a rival's final stage, gather first: marching up needs no odds,
  // the attack itself goes in with whoever stands next to it.
  const gathering = deny >= 7 && !now;
  if (ratio < needed && !gathering) return null;
  let score = t.value * Math.min(1.4, 0.6 + Math.max(0, ratio - needed) * 0.6);
  score /= 1 + tolls * 0.55;
  if (orders[a.id] === t.region) score += 0.8;
  if (a.crusade?.target === t.region) score += 4;
  if (now && t.kind !== 'tribute') {
    const sun = sunForAttacker(a.region, t.region);
    score += sun === 'back' ? 0.3 : sun === 'eyes' ? -0.3 : 0;
  }
  // Hard lands wear an army down.
  const band = bandIndex(s, t.region);
  const tr = a.lord.traits;
  if (f !== 'hush' && band === 0 && !tr.includes('provisioned') && !tr.includes('stormCloaks') && !tr.includes('lampBearer')) score -= 1.2;
  if (f !== 'choir' && f !== 'hush' && band === 4 && !tr.includes('provisioned') && !tr.includes('stormCloaks')) score -= 1.2;
  if (f === 'hush' && band >= 3 && !tr.includes('veil')) score -= band === 4 ? 2 : 0.8;
  if (f === 'choir' && band <= 1 && !tr.includes('lampBearer')) score -= 0.8;
  // Don't end the march under a stronger enemy's nose.
  if (!now && deny < 7) {
    const end = marchEnd(s, a, rt.step);
    if ((v.threat[end] ?? 0) > armyPower(a) * 1.3) score -= 2.5;
  }
  if (score <= 0) return null;
  return { a, t, score, cost: rt.cost, now };
}

/**
 * How far below its usual odds an army will fight for a region a rival's
 * victory rests on: a little in its final stage, more as its hold nears
 * the end. The +15% leadership against the leader does the rest.
 */
function urgencyOf(deny: number): number {
  return deny >= 9 ? 0.7 : deny >= 7 ? 0.8 : deny > 0 ? 0.92 : 1;
}

function needsRefit(a: ArmyState, f: FactionId): boolean {
  if (a.units.length < 4) return true;
  const h = health(a);
  if (h < 0.55) return true;
  if (f === 'drift') return fill(a) < 0.45 && h < 0.8;
  return fill(a) < 0.5 && h < 0.85;
}

function military(s: CampaignState, f: FactionId, v: View, done: Set<string>): PendingBattle[] {
  const pbs: PendingBattle[] = [];
  const mem = memory(s, f);
  const orders = (mem.orders ??= {});
  for (const id of Object.keys(orders)) if (!armyById(s, id)) delete orders[id];
  const free = factionArmies(s, f).filter((a) => !a.fought && a.moves > 0 && !done.has(a.id));
  if (!free.length) return pbs;
  const busy = new Set<string>();
  const claimed = new Set<string>();

  // Armies caught in a region with enemies (besiegers in our land): fight them or leave.
  for (const a of free) {
    const foes = hostileArmiesIn(s, a.region, f);
    if (!foes.length) continue;
    const need = sidePower(foes.filter((e) => e.faction === foes[0]!.faction)) * edgeOf(s, foes[0]!.faction, a.region, f, foes[0]!);
    const mine = armyPower(a) * edgeOf(s, f, a.region, foes[0]!.faction, a);
    if (mine >= need * PERSONA[f].nerve) {
      const pb = makeBattle(s, a, a.from && a.from !== a.region ? a.from : neighbors(a.region)[0]!, a.region);
      pbs.push(pb);
      busy.add(a.id);
      claimed.add(a.region);
    }
  }

  // The Drift hold the Kite Fields for their victory.
  if (f === 'drift') driftHold(s, v, free, busy, done);

  const targets = targetsFor(s, f, v);
  const options: Option[] = [];
  for (const a of free) {
    if (busy.has(a.id) || needsRefit(a, f)) continue;
    for (const t of targets) {
      const o = rate(s, f, v, a, t, orders);
      if (o) options.push(o);
    }
  }

  // One step from our own victory: the last pieces are taken before anything else is guarded.
  const goals = goalRegions(s, f);
  if (goals.length) {
    for (const o of options.filter((x) => goals.includes(x.t.region)).sort((x, y) => y.score - x.score || (x.a.id < y.a.id ? -1 : 1))) {
      if (busy.has(o.a.id) || claimed.has(o.t.region) || o.a.fought) continue;
      const pb = execute(s, f, o, orders);
      busy.add(o.a.id);
      if (pb) {
        claimed.add(o.t.region);
        joinPartners(s, f, pb, free, busy, v);
        pbs.push(pb);
      } else if (o.now) claimed.add(o.t.region);
    }
    // Two hosts together where one is not enough.
    combined(s, f, v, free, busy, claimed, targets.filter((x) => goals.includes(x.region)), pbs, orders);
  }

  // Defence: a threatened region of worth pulls armies home. When a rival is
  // about to win first, only the capital keeps a guard: everyone else marches.
  const defend = f === 'drift' ? [] : defenceNeeds(s, f, v).filter((dn) => !v.desperate || dn.region === v.capital);
  for (const dn of defend) {
    const st = s.regions[dn.region]!;
    const wallMult = 1 + wallLevel(s, dn.region) * 0.1;
    let have = st.owner === f && regionDef(dn.region).settlement ? garrisonEff(s, dn.region) : 0;
    const want = dn.threat * 1.1;
    // Armies already inside stay, the strongest first, as many as it takes.
    const inside = free.filter((a) => !busy.has(a.id) && a.region === dn.region).sort((x, y) => armyPower(y) - armyPower(x));
    for (const a of inside) {
      if (have >= want) break;
      busy.add(a.id);
      done.add(a.id);
      have += armyPower(a) * wallMult;
    }
    // Others of ours already there (moved or fought this Toll) count too.
    have += s.armies.filter((a) => a.faction === f && a.region === dn.region && !inside.includes(a)).reduce((t, a) => t + armyPower(a) * wallMult, 0);
    if (have >= want) continue;
    // Better to strike the threat in the field when we can.
    const strike = options.filter((o) => !busy.has(o.a.id) && o.t.kind === 'field' && neighbors(dn.region).concat(dn.region).includes(o.t.region)).sort((x, y) => y.score - x.score)[0];
    if (strike && strike.now) continue;
    const helpers = free
      .filter((a) => !busy.has(a.id) && a.region !== dn.region)
      .map((a) => ({ a, r: route(s, a, dn.region) }))
      .filter((x) => x.r && x.r.cost <= x.a.moves && x.r.step === dn.region)
      .sort((x, y) => x.r!.cost - y.r!.cost);
    for (const h of helpers) {
      if (have >= want) break;
      // Only worth it for a town we value, or if we'd make the difference.
      if (dn.value < 3 && have + armyPower(h.a) < dn.threat * 0.8) break;
      const res = moveArmy(s, h.a.id, dn.region);
      if (!res.ok) continue;
      busy.add(h.a.id);
      done.add(h.a.id);
      orders[h.a.id] = dn.region;
      have += armyPower(h.a) * (1 + wallLevel(s, dn.region) * 0.1);
      if (res.battle) pbs.push(res.battle);
    }
  }

  // Attacks: best first, one army per target unless it needs two.
  options.sort((x, y) => y.score - x.score || (x.a.id < y.a.id ? -1 : 1));
  for (const o of options) {
    if (busy.has(o.a.id) || claimed.has(o.t.region) || o.a.fought) continue;
    const pb = execute(s, f, o, orders);
    busy.add(o.a.id);
    if (pb) {
      claimed.add(o.t.region);
      joinPartners(s, f, pb, free, busy, v);
      pbs.push(pb);
    } else if (o.now) claimed.add(o.t.region);
  }

  // Combined attacks on worthy targets no single army can take.
  combined(s, f, v, free, busy, claimed, targets, pbs, orders);

  // Everyone else: refit, garrison, stage near the front, or wander (Drift).
  for (const a of free) {
    if (busy.has(a.id) || a.fought || a.moves <= 0) continue;
    busy.add(a.id);
    done.add(a.id);
    if (f === 'drift') {
      driftIdle(s, v, a, orders);
      continue;
    }
    idle(s, f, v, a, targets, orders);
  }
  return pbs;
}

function defenceNeeds(s: CampaignState, f: FactionId, v: View): { region: string; threat: number; value: number }[] {
  const out: { region: string; threat: number; value: number }[] = [];
  for (const id of ownedRegions(s, f)) {
    const t = v.threat[id] ?? 0;
    if (t <= 0) continue;
    const d = defenseOf(s, f, id);
    if (t < d * (v.focus?.kind === 'defend' ? 0.6 : 0.85)) continue;
    out.push({ region: id, threat: t, value: regionValue(s, f, id, v) + (id === v.capital ? 4 : 0) });
  }
  return out.sort((a, b) => b.value - a.value);
}

function execute(s: CampaignState, f: FactionId, o: Option, orders: Record<string, string>): PendingBattle | null {
  const a = o.a;
  const t = o.t;
  orders[a.id] = t.region;
  if (a.region === t.region) return engageHere(s, f, a, t);
  const rt = route(s, a, t.region);
  if (!rt) return null;
  const res = moveArmy(s, a.id, rt.step);
  if (!res.ok) return null;
  if (res.battle) return res.battle;
  if (res.atSettlement && a.region === t.region) return engageHere(s, f, a, t);
  if (res.atSettlement) {
    // Stopped short at another hostile town: take it if we can, else live off its land.
    const need = garrisonEff(s, a.region);
    if (armyPower(a) * edgeOf(s, f, a.region, s.regions[a.region]!.owner, a) >= need * PERSONA[f].nerve) {
      const r = assault(s, a.id);
      if (r.ok) return r.battle;
    }
    setStance(s, a.id, 'raid');
  }
  return null;
}

function engageHere(s: CampaignState, f: FactionId, a: ArmyState, t: Target): PendingBattle | null {
  if (t.kind === 'tribute') {
    const r = demandTribute(s, a.id, armyPower, (x) => garrisonPower(s, x));
    if (r.ok) return null;
  }
  if (!hostileSettlement(s, a.region, f)) return null;
  const r = assault(s, a.id);
  return r.ok ? r.battle : null;
}

/** Other armies standing with (or right behind) the attacker join its battle. */
function joinPartners(s: CampaignState, f: FactionId, pb: PendingBattle, free: ArmyState[], busy: Set<string>, v: View): void {
  const lead = armyById(s, pb.attacker.armies[0]!);
  if (!lead) return;
  const need = defenderPower(s, pb);
  let have = attackerPower(s, pb);
  if (have >= need * 1.6) return;
  const spot = pb.assault && lead.region === pb.region ? pb.region : pb.from;
  for (const p of free) {
    if (busy.has(p.id) || p.fought || p.id === lead.id || p.units.length === 0) continue;
    if (p.region !== spot) {
      const rt = findPath(s, p, spot);
      if (!rt || !rt.length || rt[rt.length - 1]!.cost > p.moves) continue;
      if (hostileArmiesIn(s, spot, f).length) continue;
      const res = moveArmy(s, p.id, spot);
      if (!res.ok || res.battle || p.region !== spot) continue;
    }
    pb.attacker.armies.push(p.id);
    p.fought = true;
    p.moves = 0;
    busy.add(p.id);
    have = attackerPower(s, pb);
    if (have >= need * 1.6 || pb.attacker.armies.length >= 3) break;
  }
  void v;
}

/** Two armies against a target neither can take alone. */
function combined(s: CampaignState, f: FactionId, v: View, free: ArmyState[], busy: Set<string>, claimed: Set<string>, targets: Target[], pbs: PendingBattle[], orders: Record<string, string>): void {
  const avail = free.filter((a) => !busy.has(a.id) && !a.fought && a.moves > 0 && !needsRefit(a, f));
  if (avail.length < 2) return;
  const cands = targets.filter((t) => !claimed.has(t.region) && t.kind !== 'tribute').sort((a, b) => b.value - a.value);
  for (const t of cands) {
    if (t.value < 4) break;
    const near = avail
      .filter((a) => !busy.has(a.id))
      .map((a) => ({ a, r: route(s, a, t.region) }))
      .filter((x) => x.r && x.r.cost <= x.a.moves && x.r.step === t.region)
      .sort((x, y) => armyPower(y.a) - armyPower(x.a));
    if (near.length < 2) continue;
    const pair = [near[0]!.a, near[1]!.a];
    const mine = sidePower(pair) * edgeOf(s, f, t.region, t.enemy, pair[0]!);
    const deny = v.deny[t.region] ?? 0;
    const urgency = urgencyOf(deny);
    if (mine < t.need * PERSONA[f].nerve * 1.05 * urgency) continue;
    const pb = execute(s, f, { a: pair[0]!, t, score: 0, cost: 0, now: true }, orders);
    busy.add(pair[0]!.id);
    if (!pb) continue;
    claimed.add(t.region);
    joinPartners(s, f, pb, [pair[1]!], busy, v);
    pbs.push(pb);
  }
}

/** No target: heal, keep order, or stand where the next war will be. */
function idle(s: CampaignState, f: FactionId, v: View, a: ArmyState, targets: Target[], orders: Record<string, string>): void {
  const own = ownedRegions(s, f);
  const here = s.regions[a.region]!;
  // Hostile land and nothing to take: raid it, unless we are hurt.
  if (regionStance(s, a) === 'hostile' && !needsRefit(a, f) && (v.threat[a.region] ?? 0) < armyPower(a)) {
    setStance(s, a.id, 'raid');
    return;
  }
  // Weak: go where we can recruit, the best site nearby.
  if (needsRefit(a, f) || fill(a) < 0.8) {
    const site = refitSite(s, f, a, v);
    if (site && site !== a.region) {
      orders[a.id] = site;
      const r = route(s, a, site);
      if (r) moveArmy(s, a.id, r.step);
      return;
    }
    if (site === a.region) return;
  }
  // A rival about to win: stand ready beside what its victory rests on (or,
  // for an open field like the Kite Fields, in it: an enemy host there
  // breaks the hold the moment war comes).
  if (stageAgainstRival(s, f, a, orders)) return;
  // A town about to riot wants us inside.
  if (here.owner === f && v.needGarrison.has(a.region)) return;
  const riot = [...v.needGarrison].map((id) => ({ id, r: route(s, a, id) })).filter((x) => x.r && x.r.cost <= a.moves * 2).sort((x, y) => x.r!.cost - y.r!.cost)[0];
  if (riot && !s.armies.some((o) => o.faction === f && o.region === riot.id)) {
    orders[a.id] = riot.id;
    moveArmy(s, a.id, riot.r!.step);
    return;
  }
  // Stage on the frontier facing the best targets we cannot take yet.
  let best: string | null = null;
  let bs = -Infinity;
  for (const id of own) {
    if (!regionDef(id).settlement) continue;
    let sc = 0;
    for (const t of targets) if (neighbors(id).includes(t.region)) sc += t.value * (t.need < armyPower(a) * 2 ? 1 : 0.4);
    sc += ((v.threat[id] ?? 0) / 3000) * (id === v.capital ? 2 : 1);
    // The Hush camp with the herds: an army among them eats nothing.
    if (f === 'hush') sc += Math.min(4, herdIn(s, id)) * (v.hungry ? 1.2 : 0.4);
    const r = route(s, a, id);
    if (!r) continue;
    sc -= r.cost / 100;
    if (sc > bs) {
      bs = sc;
      best = id;
    }
  }
  if (best && best !== a.region && bs > 0.5) {
    orders[a.id] = best;
    const r = route(s, a, best);
    if (r) moveArmy(s, a.id, r.step);
    return;
  }
  if (!own.includes(a.region) && own.length) {
    const site = refitSite(s, f, a, v);
    if (site) {
      const r = route(s, a, site);
      if (r) moveArmy(s, a.id, r.step);
    }
  }
}

function stageAgainstRival(s: CampaignState, f: FactionId, a: ArmyState, orders: Record<string, string>): boolean {
  const rival = FACTION_IDS.find((o) => o !== f && s.factions[o].alive && overlordOf(s, o) !== f && (s.factions[o].finalStage || (s.turn >= VICTORY_OPENS - 6 && closeToWinning(s, o))));
  if (!rival || needsRefit(a, f)) return false;
  const spots = new Set<string>();
  const open = (n: string) => !hostileSettlement(s, n, f) && !hostileArmiesIn(s, n, f).length;
  for (const c of criticalRegions(s, rival)) {
    if (!regionDef(c).settlement && open(c)) spots.add(c);
    for (const n of neighbors(c)) if (open(n)) spots.add(n);
  }
  if (spots.has(a.region)) return true;
  let best: { id: string; cost: number; step: string } | null = null;
  for (const id of spots) {
    const r = route(s, a, id);
    if (!r || r.cost > maxMoves(a) * 3) continue;
    if (!best || r.cost < best.cost) best = { id, cost: r.cost, step: r.step };
  }
  if (!best) return false;
  orders[a.id] = best.id;
  moveArmy(s, a.id, best.step);
  return true;
}

/** The best place nearby to refill an army. */
function refitSite(s: CampaignState, f: FactionId, a: ArmyState, v: View): string | null {
  const steps = stepsFrom(a.region);
  let best: string | null = null;
  let bs = -Infinity;
  for (const id of ownedRegions(s, f)) {
    if (!regionDef(id).settlement) continue;
    const d = steps[id] ?? 99;
    if (d > 6) continue;
    // Recruiting also works from next door: judge the best site in reach of the spot.
    let q = 0;
    for (const n of [id, ...neighbors(id)]) {
      const st = s.regions[n]!;
      if (st.owner !== f || !regionDef(n).settlement) continue;
      q = Math.max(q, siteQuality(s, n));
    }
    const danger = (v.threat[id] ?? 0) > defenseOf(s, f, id) + armyPower(a) ? 3 : 0;
    // The colossus waits at its wonder for a host to walk with.
    const wonderHere = colossusDue(s, f) && s.factions[f].coin > 3200 + v.reserve && s.regions[id]!.slots.some((x) => x && x.level > 0 && chainDef(x.chain).kind === 'wonder') ? 6 : 0;
    const sc = q - d * 1.4 - danger + (id === v.capital ? 1 : 0) + wonderHere;
    if (sc > bs) {
      bs = sc;
      best = id;
    }
  }
  return best;
}

// ------------------------------------------------------------ Drift sails

/** Late in the game the sails gather on the Kite Fields and hold the moot. */
function driftHold(s: CampaignState, v: View, free: ArmyState[], busy: Set<string>, done: Set<string>): void {
  const d = s.factions.drift;
  const ready = s.turn >= VICTORY_OPENS - 2 && d.res >= 900;
  if (!ready) return;
  const orders = (memory(s, 'drift').orders ??= {});
  // Only stand when the sails can hold the moot: every host near enough to
  // strike the Fields will come (a peace lasts only until the moot begins).
  // Near the end of the hold, stand regardless.
  const { danger, ours } = mootOdds(s);
  const holdOn = d.finalStage && d.hold >= HOLD_NEEDED.drift - 2;
  if (!holdOn && danger > ours * 0.9) {
    // Not yet: sail on, grow, and leave the Fields to anyone who would crush us there.
    for (const a of free) {
      if (a.region !== KITE_FIELDS || busy.has(a.id)) continue;
      const out = GALE_ROAD.filter((r) => r !== KITE_FIELDS && neighbors(KITE_FIELDS).includes(r) && !hostileArmiesIn(s, r, 'drift').length && !hostileSettlement(s, r, 'drift'));
      const to = out.sort((x, y) => (v.threat[x] ?? 0) - (v.threat[y] ?? 0))[0];
      if (to && (v.threat[KITE_FIELDS] ?? 0) > armyPower(a)) {
        busy.add(a.id);
        done.add(a.id);
        moveArmy(s, a.id, to);
      }
    }
    return;
  }
  const armies = free.filter((a) => !busy.has(a.id)).sort((a, b) => armyPower(b) - armyPower(a));
  // Keep the strongest sails at the Fields; one keeps sailing for Renown if short of it.
  const keepSailing = d.res < 1000 ? 1 : 0;
  let sent = 0;
  for (const a of armies) {
    if (sent >= armies.length - keepSailing && a.region !== KITE_FIELDS) break;
    busy.add(a.id);
    done.add(a.id);
    sent++;
    if (a.region === KITE_FIELDS) continue;
    orders[a.id] = KITE_FIELDS;
    const foes = hostileArmiesIn(s, KITE_FIELDS, 'drift');
    if (foes.length && armyPower(a) < sidePower(foes) * PERSONA.drift.nerve) continue;
    moveArmy(s, a.id, KITE_FIELDS);
  }
}

/** The hosts that could fall on the Kite Fields, against the sails near enough to stand there. */
function mootOdds(s: CampaignState): { danger: number; ours: number } {
  const steps = stepsFrom(KITE_FIELDS);
  const near = factionArmies(s, 'drift').filter((a) => (steps[a.region] ?? 9) <= 2).sort((a, b) => armyPower(b) - armyPower(a));
  return { danger: Math.round(sailDanger(s, KITE_FIELDS)), ours: Math.round(sidePower(near) * EDGE.drift[bandIndex(s, KITE_FIELDS)]! * 1.05) };
}

/**
 * Power that could fall on sails standing in a region over the next Tolls:
 * every host that is not our ally (a peace lasts only until the Great Moot
 * begins), in full when it can strike at once, less the farther it must
 * march. The strongest faction's side counts in full, the others' at half.
 */
function sailDanger(s: CampaignState, region: string): number {
  const steps = stepsFrom(region);
  const band = bandIndex(s, region);
  const sides: number[] = [];
  for (const o of FACTION_IDS) {
    if (o === 'drift' || !s.factions[o].alive || allied(s, 'drift', o)) continue;
    const by = (reach: number) => sidePower(s.armies.filter((x) => x.faction === o && (steps[x.region] ?? 9) <= reach).sort((x, y) => armyPower(y) - armyPower(x)));
    const [p2, p3, p4] = [by(2), by(3), by(4)];
    const p = p2 + (p3 - p2) * 0.85 + (p4 - p3) * 0.6;
    if (p > 0) sides.push(p * EDGE[o][band]! * 1.07);
  }
  sides.sort((x, y) => y - x);
  return (sides[0] ?? 0) + sides.slice(1).reduce((t, x) => t + x, 0) * 0.5;
}

/**
 * Near the Great Moot only driftHold sends sails onto the Kite Fields: a sail
 * that merely passes through and stops there for the night would begin the
 * moot, and bring every rival's war down on it, before the sails are ready.
 */
function mootNear(s: CampaignState): boolean {
  return s.turn >= VICTORY_OPENS - 4 && s.factions.drift.res >= 900;
}

function strandsOnFields(s: CampaignState, a: ArmyState, to: string): boolean {
  return a.faction === 'drift' && to !== KITE_FIELDS && a.region !== KITE_FIELDS && mootNear(s) && marchEnd(s, a, to) === KITE_FIELDS;
}

/** No target: sail the Gale Roads through every band for Renown, or sit on a mooring. */
function driftIdle(s: CampaignState, v: View, a: ArmyState, orders: Record<string, string>): void {
  const seen = new Set(a.bandsVisited ?? []);
  const steps = stepsFrom(a.region);
  // Near the Great Moot the Fields are driftHold's call alone (a sail
  // wandering onto them starts the moot, and the coalition's war, too
  // early); the sails gather near them instead, ready for an opening.
  const moot = mootNear(s);
  const kf = moot ? stepsFrom(KITE_FIELDS) : null;
  let best: string | null = null;
  let bs = -Infinity;
  for (const r of REGIONS) {
    const id = r.id;
    if (id === a.region) continue;
    if (moot && id === KITE_FIELDS) continue;
    if (hostileArmiesIn(s, id, 'drift').length) continue;
    if (hostileSettlement(s, id, 'drift')) continue;
    const rt = findPath(s, a, id);
    if (!rt || !rt.length) continue;
    if (strandsOnFields(s, a, id)) continue;
    const cost = rt[rt.length - 1]!.cost;
    const b = bandIndex(s, id);
    let sc = 0;
    if (!seen.has(b)) sc += 5 - Math.min(4, (steps[id] ?? 9) * 0.6);
    if (kf && (kf[id] ?? 9) <= 2) sc += 2.5;
    if (r.galeRoad) sc += 1.5;
    if (s.regions[id]!.mooring) sc += 0.6;
    if (bandIndex(s, id) === 0 || bandIndex(s, id) === 4) sc -= r.galeRoad ? 0 : 3;
    sc -= cost / 120;
    // Keep clear of hosts at war with us: a beaten sail with nowhere to run is lost.
    const threat = v.threat[id] ?? 0;
    if (threat > armyPower(a)) sc -= 8;
    else if (threat > armyPower(a) * 0.6) sc -= 3;
    if (sc > bs) {
      bs = sc;
      best = id;
    }
  }
  // Raid if we sit in enemy land with nothing better to do.
  if (regionStance(s, a) === 'hostile' && !needsRefit(a, 'drift') && (!best || bs < 2)) {
    setStance(s, a.id, 'raid');
    return;
  }
  if (best) {
    orders[a.id] = best;
    moveArmy(s, a.id, best);
  }
}

// --------------------------------------------------------- after the march

function afterMarch(s: CampaignState, f: FactionId, v: View): void {
  const fs = s.factions[f];
  if (f === 'hush') for (const c of CANDLES) if (s.regions[c]!.owner === 'hush' && s.regions[c]!.lit) extinguish(s, c);
  if (f === 'choir') for (const c of CANDLES) if (s.regions[c]!.owner === 'choir' && !s.regions[c]!.lit) relight(s, c);
  // New conquests need order before they riot.
  if (f !== 'drift') orderCare(s, f, v);
  // Armies that stopped in hostile land live off it.
  for (const a of factionArmies(s, f)) {
    if (a.fought || a.stance === 'raid') continue;
    if (regionStance(s, a) === 'hostile' && !(f === 'drift' && s.regions[a.region]!.mooring)) {
      if (f === 'drift' && s.regions[a.region]!.owner === 'free' && regionDef(a.region).settlement) {
        if (demandTribute(s, a.id, armyPower, (x) => garrisonPower(s, x)).ok) continue;
      }
      setStance(s, a.id, 'raid');
    }
  }
  // Can't pay or feed the troops: send the worst home for good.
  const broke = fs.coin < 0 && v.net < 0;
  const starving = fs.food < 5 && v.foodNet < 0;
  if (broke || starving) {
    const armies = factionArmies(s, f).sort((a, b) => armyUpkeep(b) - armyUpkeep(a));
    let net = v.net;
    let food = v.foodNet;
    const short = () => (broke && net < 0) || (starving && food < 0);
    for (const a of armies) {
      while (short() && a.units.length > 4) {
        let worst = 0;
        for (let i = 1; i < a.units.length; i++) if (strengthOf(a.units[i]!) < strengthOf(a.units[worst]!)) worst = i;
        net += Math.round(unitDef(a.units[worst]!.def).cost * 0.05);
        food += rationOf(s, f, a);
        disband(s, a.id, worst);
      }
      if (!short()) break;
    }
  }
  // Leftover coin after the fighting: fill up where we stand.
  if (fs.coin > v.reserve + 1500) recruitment(s, f, look(s, f));
  void GROWTH_NEEDED;
}

export function aiPreviewTargets(s: CampaignState, f: FactionId): string[] {
  return targetsFor(s, f, look(s, f)).map((t) => t.region);
}

/** What the AI sees and would do with each army, for tools and debugging. Changes nothing. */
export function aiExplain(s: CampaignState, f: FactionId): { view: Record<string, unknown>; targets: Target[]; armies: { id: string; region: string; power: number; units: number; refit: boolean; options: { region: string; kind: string; score: number; ratio: number; tolls: number }[] }[] } {
  const v = look(s, f);
  const targets = targetsFor(s, f, v);
  const orders = s.factions[f].ai?.orders ?? {};
  const armies = factionArmies(s, f).map((a) => {
    const options = targets
      .map((t) => {
        const o = rate(s, f, v, a, t, orders);
        const rt = route(s, a, t.region);
        const ratio = (armyPower(a) * edgeOf(s, f, t.region, t.enemy, a)) / Math.max(1, t.need);
        return { region: t.region, kind: t.kind, score: o ? Math.round(o.score * 100) / 100 : 0, ratio: Math.round(ratio * 100) / 100, tolls: rt ? Math.ceil(Math.max(0, rt.cost - a.moves) / maxMoves(a)) : 99 };
      })
      .sort((x, y) => y.score - x.score)
      .slice(0, 6);
    return { id: a.id, region: a.region, power: Math.round(armyPower(a)), units: a.units.length, refit: needsRefit(a, f), options };
  });
  const view: Record<string, unknown> = { phase: v.phase, wars: v.wars, net: v.net, foodNet: v.foodNet, reserve: v.reserve, leader: v.leader, urgent: v.urgent, hungry: v.hungry, unrest: v.unrest, deny: v.deny, capital: v.capital, cap: armyCap(s, f), saving: v.saving, hubs: v.hubs };
  if (f === 'drift') view.moot = mootOdds(s);
  return { view, targets, armies };
}

export { attackerPower, defenderPower, chainLevel, factionChains };
