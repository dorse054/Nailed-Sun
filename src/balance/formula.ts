/**
 * The design doc's cost formula:
 *
 *     Cost = k * sqrt(EHP * EDPS) * s + a
 *
 * computed from a unit's stats so the report can set it beside the unit's
 * actual cost. Definitions (every constant is named below):
 *
 * EHP, effective hit points of the whole unit: total HP (a lord's leader
 * counts with its own HP, Old Midnight's elk team adds its share) divided by
 * an exposure factor, where exposure = 75% melee + 25% missile:
 *   - melee exposure: the expected damage per swing of a reference line
 *     soldier (MA 30, 22 damage + 8 AP) against the unit's MD and armor,
 *     relative to the same swing against MD 30 and no armor;
 *   - missile exposure: a reference arrow (12 + 3 AP) against the unit's
 *     armor, relative to no armor, after the shield's frontal block (2 of 3
 *     shots come from the front) and Scatter.
 *   Brittle and fire vulnerability raise exposure a little.
 *
 * EDPS, expected damage per second of the whole unit against a reference
 * target mix (70% line infantry: MD 36, armor 45, 25% shields; 30% cavalry:
 * MD 26, armor 50, large):
 *   - melee: hit chance x expected hit (the doc's two combat formulas with
 *     u ~ U(0.5, 1), so E[u] = 0.75) / swing interval, with vs-large and
 *     vs-infantry bonuses, one charge per 20 s of fighting (the fading charge
 *     bonus averages half its value over 5 s), splash on extra victims, and a
 *     contact share of min(1, 2 / ranks): only the front two ranks of a block
 *     reach the enemy;
 *   - missile: shots per second x hit probability x expected hit x victims
 *     per shot (splash, pierce, line beams and cones hit several) x shield
 *     block, times availability (the share of a 150 s fight its ammunition
 *     lasts) and a range factor sqrt(range / 150), clamped to 0.5..2.
 *   Beams are taken at Dusk (100%). Melee and missile EDPS add up.
 *
 * s, speed multiplier: (speed / 5) ^ 0.3.
 *
 * a, ability value: a sum of heuristic point values for named mechanics,
 * abilities and unit passives (tables below). Faction traits are left out
 * because they apply to every unit of the faction alike.
 *
 * k is fitted, not chosen, once per role family (melee infantry, missile
 * infantry, cavalry, monsters and flyers, artillery, support, characters,
 * colossi): the median of (cost - a) / (sqrt(EHP * EDPS) * s) over the
 * family. A single k can't work, because sqrt(EHP * EDPS) has no term for
 * standing off at range: fragile artillery would all read as 5-10x
 * overpriced. With k per family, a unit's deviation says how its price
 * compares with what its stats earn next to the other units of its kind.
 */
import type { Mechanic, MeleeWeapon, MissileWeapon, UnitDef } from '../data/schema';
import { FACTIONS, allFactionUnits } from '../data/index';
import { COMBAT } from '../data/rules';
import { formationSpec } from '../sim/army';

export type CostFamily = 'infantry' | 'missile' | 'cavalry' | 'monster' | 'artillery' | 'support' | 'character' | 'colossus';

export interface CostBreakdown {
  id: string;
  name: string;
  faction: string;
  role: string;
  category: string;
  family: CostFamily;
  cost: number;
  hp: number;
  ehp: number;
  meleeDps: number;
  missileDps: number;
  edps: number;
  s: number;
  a: number;
  /** The family's fitted k. */
  k: number;
  /** k * sqrt(EHP * EDPS) * s. */
  base: number;
  /** base + a. */
  formula: number;
  /** actual / formula - 1. */
  deviation: number;
}

const REF_ATTACKER = { ma: 30, base: 22, ap: 8 };
const REF_ARROW = { damage: 12, ap: 3 };
const REF_SMALL = { md: 36, armor: 45, shield: 0.25, share: 0.7 };
const REF_LARGE = { md: 26, armor: 50, share: 0.3 };
const EXPOSURE_MIX = { melee: 0.75, missile: 0.25 };
const CHARGE_SHARE = 2.5 / 20;
const FIGHT_SECONDS = 150;
const ARC_HIT = 0.5;
const DIRECT_HIT = 0.6;
const BEAM_HIT = 0.8;
/** Soldiers per square meter in a formed block, and the share a splash really catches. */
const BLOCK_DENSITY = 0.5;
const SPLASH_CATCH = 0.35;

/** Heuristic point values for named mechanics (a). Drawbacks are negative. */
export const MECHANIC_VALUE: Partial<Record<Mechanic['kind'], number>> = {
  brittle: -60,
  glassblind: -20,
  mirrorflash: 60,
  lockMirrors: 60,
  noFatigueInLight: 20,
  burningFaith: 40,
  moltenCore: 120,
  glows: -30,
  marks: 40,
  stealth: 120,
  ambush: 80,
  silentCharge: 40,
  zone: 80,
  blind: 20,
  flyer: 200,
  fireVulnerable: -40,
  lure: 80,
  hooks: 60,
  braceBonus: 30,
  pavise: 40,
  bell: 200,
  tollRelay: 60,
  tollCharge: 80,
  scatter: 60,
  moored: 30,
  leapingCharge: 60,
  howl: 200,
  fearAura: 80,
  hearHidden: 60,
  hideAura: 60,
  heatImmune: 20,
  vsRouting: 30,
  vsMissile: 40,
  garrison: 150,
  carrier: 150,
  drawnToFlame: -40,
  coreExposed: -80,
  signalMark: 80,
  repairer: 100,
  refitsOnCarrier: 20,
  feignedFlight: 60,
  windReader: 40,
  lanternSight: 30,
};

/** Zones worth more than the default zone value (they are the unit's purpose). */
export const ZONE_VALUE: Record<string, number> = { veil: 250, eclipse: 250, walkingNoon: 150, lure: 80, lantern: 60 };
export const ABILITY_VALUE = { active: 60, bigActive: 120, toggle: 40, passive: 30 };

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

function hitChance(ma: number, md: number): number {
  return clamp(COMBAT.hitBase + (ma - md) / 100, COMBAT.hitMin, COMBAT.hitMax);
}

/** E[D] for D = B(1 - uA/100) + AP with u ~ U(0.5, 1). */
function expectedHit(base: number, ap: number, armor: number): number {
  const eu = (COMBAT.armorRollMin + COMBAT.armorRollMax) / 2;
  return Math.max(0, base * (1 - (eu * clamp(armor, 0, 100)) / 100)) + ap;
}

function addSplit(base: number, ap: number, bonus: number): [number, number] {
  const t = base + ap;
  if (t <= 0) return [base + bonus, ap];
  return [base + (bonus * base) / t, ap + (bonus * ap) / t];
}

function mech<K extends Mechanic['kind']>(def: UnitDef, kind: K): Extract<Mechanic, { kind: K }> | undefined {
  return def.mechanics?.find((m) => m.kind === kind) as Extract<Mechanic, { kind: K }> | undefined;
}

export function costFamily(def: UnitDef): CostFamily {
  if (def.category === 'colossus') return 'colossus';
  if (def.character || def.category === 'character') return 'character';
  switch (def.role) {
    case 'missile':
      return 'missile';
    case 'shockCav':
    case 'missileCav':
      return 'cavalry';
    case 'monster':
    case 'flyer':
      return 'monster';
    case 'artillery':
      return 'artillery';
    case 'support':
      return 'support';
    default:
      return 'infantry';
  }
}

function totalHp(def: UnitDef): number {
  let hp = def.soldiers * def.hp;
  if (def.leader) hp += def.leader.hp - def.hp;
  const elk = mech(def, 'elkTeam');
  if (elk) hp *= 1 + elk.hpPct / 100;
  return hp;
}

function exposure(def: UnitDef): number {
  const ref = hitChance(REF_ATTACKER.ma, REF_ATTACKER.ma) * expectedHit(REF_ATTACKER.base, REF_ATTACKER.ap, 0);
  const melee = (hitChance(REF_ATTACKER.ma, def.md) * expectedHit(REF_ATTACKER.base, REF_ATTACKER.ap, def.armor)) / ref;
  const block = Math.min(0.9, (def.shield ?? 0) * (2 / 3));
  let missile = ((1 - block) * expectedHit(REF_ARROW.damage, REF_ARROW.ap, def.armor)) / expectedHit(REF_ARROW.damage, REF_ARROW.ap, 0);
  const scatter = mech(def, 'scatter');
  if (scatter) missile *= 1 - scatter.missileReduction;
  let e = EXPOSURE_MIX.melee * melee + EXPOSURE_MIX.missile * missile;
  if (mech(def, 'brittle')) e *= 1.1;
  const fv = mech(def, 'fireVulnerable');
  if (fv) e *= 1 + (fv.pct / 100) * 0.15;
  return e;
}

/** Expected melee damage per second of one soldier with weapon w and MA ma. */
function meleeDpsPer(w: MeleeWeapon, ma: number, charge: number): number {
  const maEff = ma + charge * CHARGE_SHARE;
  const cbDmg = charge * 0.8 * CHARGE_SHARE;
  const extra = w.splash && w.splash.targets > 1 ? w.splash.targets - 1 : 0;
  // Against line infantry.
  let [b, ap] = addSplit(w.base, w.ap, cbDmg);
  if (w.vsInfantry) [b, ap] = addSplit(b, ap, w.vsInfantry);
  const small = hitChance(maEff, REF_SMALL.md) * expectedHit(b, ap, REF_SMALL.armor) * (1 + 0.8 * extra * 0.6);
  // Against cavalry.
  let [bl, apl] = addSplit(w.base, w.ap, cbDmg);
  if (w.vsLarge) [bl, apl] = addSplit(bl, apl, w.vsLarge);
  const large = hitChance(maEff, REF_LARGE.md) * expectedHit(bl, apl, REF_LARGE.armor) * (1 + 0.8 * extra * 0.2);
  return (REF_SMALL.share * small + REF_LARGE.share * large) / w.interval;
}

function meleeDps(def: UnitDef): number {
  const contact = Math.min(1, 2 / Math.max(1, formationSpec(def).ranks));
  if (def.leader) return meleeDpsPer(def.leader.weapon, def.leader.ma, def.charge) + (def.soldiers - 1) * meleeDpsPer(def.weapon, def.ma, def.charge) * contact;
  return def.soldiers * meleeDpsPer(def.weapon, def.ma, def.charge) * contact;
}

function victimsPerShot(m: MissileWeapon): number {
  if (m.trajectory === 'lineBeam') return 6;
  if (m.trajectory === 'cone') return 10;
  if (m.splash) return 1 + Math.min(20, SPLASH_CATCH * Math.PI * m.splash * m.splash * BLOCK_DENSITY);
  if (m.pierce) return 1 + (m.pierce - 1) * 0.4;
  return 1;
}

function missileDps(def: UnitDef): number {
  const m = def.missile;
  if (!m) return 0;
  const beam = m.trajectory === 'beam' || m.trajectory === 'lineBeam';
  const hit = beam ? BEAM_HIT : m.trajectory === 'cone' ? 1 : m.trajectory === 'arc' ? ARC_HIT : DIRECT_HIT;
  const acc = m.trajectory === 'cone' ? 1 : m.accuracy;
  const shielded = !(m.ignoresShields || m.type === 'resonance' || beam);
  const block = shielded ? 1 - REF_SMALL.shield * (2 / 3) : 1;
  const armorMult = m.armorMult ?? 1;
  const small = expectedHit(m.damage, m.ap, REF_SMALL.armor * armorMult) * block;
  const [bl, apl] = m.vsLarge ? addSplit(m.damage, m.ap, m.vsLarge) : [m.damage, m.ap];
  const large = expectedHit(bl, apl, REF_LARGE.armor * armorMult);
  const perShot = (REF_SMALL.share * small + REF_LARGE.share * large) * hit * acc * victimsPerShot(m);
  const availability = Math.min(1, (m.ammo * m.reload) / FIGHT_SECONDS);
  const range = m.windRange ? m.windRange.calm : m.range;
  const rangeFactor = clamp(Math.sqrt(range / 150), 0.5, 2);
  return def.soldiers * (perShot / m.reload) * availability * rangeFactor;
}

function speedMult(def: UnitDef): number {
  return Math.pow(Math.max(0.5, def.speed) / 5, 0.3);
}

/** Ability value a: mechanics, abilities and passives. */
export function abilityValue(def: UnitDef): number {
  let a = 0;
  for (const m of def.mechanics ?? []) {
    if (m.kind === 'zone') a += ZONE_VALUE[m.zone] ?? MECHANIC_VALUE.zone ?? 0;
    else a += MECHANIC_VALUE[m.kind] ?? 0;
  }
  for (const ab of def.abilities ?? []) {
    if (ab.kind === 'toggle') a += ABILITY_VALUE.toggle;
    else a += (ab.windup ?? 0) >= 2 || ab.uses !== undefined ? ABILITY_VALUE.bigActive : ABILITY_VALUE.active;
  }
  a += (def.passives?.length ?? 0) * ABILITY_VALUE.passive;
  return a;
}

interface Raw {
  hp: number;
  ehp: number;
  melee: number;
  missile: number;
  s: number;
  a: number;
  /** sqrt(EHP * EDPS) * s */
  core: number;
}

function raw(def: UnitDef): Raw {
  const hp = totalHp(def);
  const ehp = hp / exposure(def);
  const melee = meleeDps(def);
  const missile = missileDps(def);
  const s = speedMult(def);
  return { hp, ehp, melee, missile, s, a: abilityValue(def), core: Math.sqrt(ehp * (melee + missile)) * s };
}

function everyUnit(): UnitDef[] {
  const out: UnitDef[] = [];
  for (const f of Object.values(FACTIONS)) for (const def of allFactionUnits(f)) if (!def.hidden) out.push(def);
  return out;
}

let fitted: Map<CostFamily, number> | null = null;

/** k for each role family: the median ratio, so outliers don't drag it. */
export function formulaK(): Map<CostFamily, number> {
  if (fitted) return fitted;
  const logs = new Map<CostFamily, number[]>();
  for (const def of everyUnit()) {
    const r = raw(def);
    const net = def.cost - r.a;
    if (r.core <= 0 || net <= 0) continue;
    const fam = costFamily(def);
    if (!logs.has(fam)) logs.set(fam, []);
    logs.get(fam)!.push(Math.log(net / r.core));
  }
  fitted = new Map();
  for (const [fam, list] of logs) fitted.set(fam, Math.exp(median(list)));
  return fitted;
}

/** Formula cost of one unit, with every term. */
export function costFormula(def: UnitDef): CostBreakdown {
  const fam = costFamily(def);
  const k = formulaK().get(fam) ?? 1;
  const r = raw(def);
  const base = k * r.core;
  const formula = base + r.a;
  return {
    id: def.id,
    name: def.name,
    faction: def.faction,
    role: def.role,
    category: def.category,
    family: fam,
    cost: def.cost,
    hp: Math.round(r.hp),
    ehp: Math.round(r.ehp),
    meleeDps: round2(r.melee),
    missileDps: round2(r.missile),
    edps: round2(r.melee + r.missile),
    s: round2(r.s),
    a: Math.round(r.a),
    k: round2(k),
    base: Math.round(base),
    formula: Math.round(formula),
    deviation: formula > 0 ? def.cost / formula - 1 : 0,
  };
}

/** Every unit of every faction (regulars, colossus, lord, heroes). */
export function costFormulaTable(): CostBreakdown[] {
  return everyUnit().map(costFormula);
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
