/**
 * Builds sensible armies to a budget: a lord, a battle line, missiles,
 * cavalry and support in each faction's proportions.
 */
import type { FactionId, UnitDef } from '../data/schema';
import { FACTIONS } from '../data/index';
import { ARMY } from '../data/rules';
import type { Rng } from '../core/rng';
import type { UnitSpec } from '../sim/types';

/** How each faction likes to spend: weights per unit id. */
const DOCTRINE: Record<FactionId, Record<string, number>> = {
  choir: {
    'choir.kilnAcolytes': 3,
    'choir.mirrorWardens': 3,
    'choir.gnomonGuard': 2.2,
    'choir.cinderPenitents': 1.6,
    'choir.shardbows': 2.2,
    'choir.lenswrights': 2,
    'choir.heliographerRiders': 1,
    'choir.kilnbackLancers': 1.2,
    'choir.moltenSaints': 0.8,
    'choir.heliostatBattery': 1,
    'choir.cinderglassMangonel': 1,
    'choir.glasswright': 0.6,
    'choir.anvilWalker': 0.5,
  },
  hush: {
    'hush.glowkinLurers': 3,
    'hush.rimeguard': 2.2,
    'hush.theUnlit': 1.8,
    'hush.hushbows': 2.4,
    'hush.veilweavers': 1.2,
    'hush.rimeHounds': 1.4,
    'hush.grueHunters': 1.3,
    'hush.duskMothRiders': 1,
    'hush.lanternmaws': 0.8,
    'hush.rimeSpitters': 1,
    'hush.whalebreakerBallista': 0.8,
    'hush.listener': 0.6,
    'hush.paleHuntress': 0.5,
  },
  vesperate: {
    'vesperate.hourLevy': 2.6,
    'vesperate.lanternGuard': 3,
    'vesperate.oathswornHalberdiers': 2.2,
    'vesperate.knellguard': 1.4,
    'vesperate.vesperArbalests': 2.4,
    'vesperate.lamplighters': 1,
    'vesperate.bellOutriders': 1,
    'vesperate.antleredLancers': 1.3,
    'vesperate.knellCannon': 0.9,
    'vesperate.counterweightEngine': 1,
    'vesperate.belfryWagon': 1.1,
    'vesperate.lamplighterCaptain': 0.5,
    'vesperate.bellwright': 0.5,
  },
  drift: {
    'drift.reedspears': 2.6,
    'drift.galeDancers': 1.6,
    'drift.anchorGuard': 2.2,
    'drift.windbows': 2.4,
    'drift.dustrunners': 1.4,
    'drift.striderArchers': 2,
    'drift.striderLancers': 1.4,
    'drift.galewings': 1,
    'drift.howlingKites': 0.9,
    'drift.sailcartBallistae': 1,
    'drift.firekiteBattery': 1,
    'drift.windReader': 0.6,
    'drift.skywarden': 0.5,
  },
};

/** Minimum share of the army in its main line. */
function isLine(u: UnitDef): boolean {
  return u.category === 'infantry' && (u.role === 'line' || u.role === 'antiLarge' || u.role === 'shock');
}

export interface ArmyOptions {
  /** 'yes' always includes the colossus, 'no' never, 'maybe' by chance. */
  colossus?: 'yes' | 'no' | 'maybe';
  /** Units excluded (for tests). */
  exclude?: string[];
  maxUnits?: number;
}

export function generateArmy(faction: FactionId, budget: number, rng: Rng, opts: ArmyOptions = {}): UnitSpec[] {
  const f = FACTIONS[faction];
  const out: UnitDef[] = [f.lord];
  let left = budget - f.lord.cost;
  const maxUnits = opts.maxUnits ?? ARMY.maxUnits;
  const wantColossus = opts.colossus === 'yes' || (opts.colossus !== 'no' && budget >= 9000 && rng.chance(0.35));
  if (wantColossus && left >= f.colossus.cost + 2500) {
    out.push(f.colossus);
    left -= f.colossus.cost;
  }
  const pool = [...f.units, ...f.heroes].filter((u) => !opts.exclude?.includes(u.id));
  const count = (pred: (u: UnitDef) => boolean) => out.filter(pred).length;
  let guard = 0;
  while (out.length - 1 < maxUnits && guard++ < 200) {
    const affordable = pool.filter((u) => u.cost <= left);
    if (!affordable.length) break;
    const lines = count(isLine);
    const missiles = count((u) => u.role === 'missile');
    const heroes = count((u) => u.role === 'hero');
    const artillery = count((u) => u.role === 'artillery');
    const monsters = count((u) => u.role === 'monster');
    // Near the unit limit, lean toward units that use the budget: an army of cheap units
    // would otherwise hit the limit with points unspent and fight below its budget.
    const slotsLeft = Math.max(1, maxUnits - (out.length - 1));
    const perSlot = left / slotsLeft;
    const fillAt = slotsLeft <= 4 ? 0.8 : 0.5;
    const weights = affordable.map((u) => {
      let w = DOCTRINE[faction][u.id] ?? 1;
      const n = count((x) => x.id === u.id);
      w /= 1 + n * 0.8;
      if (isLine(u) && lines < 3) w *= 3;
      if (u.role === 'missile' && missiles < 2) w *= 1.8;
      if (u.role === 'hero' && heroes >= 1) w *= 0.15;
      if (u.role === 'artillery' && artillery >= 2) w *= 0.2;
      if (u.role === 'monster' && monsters >= 1) w *= 0.3;
      const fill = u.cost / perSlot;
      if (fill < fillAt) w *= Math.max(0.05, fill / fillAt) ** 2;
      return w;
    });
    const total = weights.reduce((a, w) => a + w, 0);
    let r = rng.next() * total;
    let pick = affordable[0]!;
    for (let i = 0; i < affordable.length; i++) {
      r -= weights[i]!;
      if (r <= 0) {
        pick = affordable[i]!;
        break;
      }
    }
    out.push(pick);
    left -= pick.cost;
  }
  return out.map((u) => ({ def: u.id }));
}

export function armyCost(units: UnitSpec[]): number {
  let c = 0;
  for (const s of units) {
    const u = findDef(s.def);
    if (u) c += u.cost;
  }
  return c;
}

function findDef(id: string): UnitDef | undefined {
  for (const f of Object.values(FACTIONS)) {
    for (const u of [...f.units, f.colossus, f.lord, ...f.heroes]) if (u.id === id) return u;
  }
  return undefined;
}
