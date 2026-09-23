import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { PI } from '../src/core/dmath';
import { beamMult, COMBAT, LIGHT_RULES, WIND_RULES } from '../src/data/rules';
import { unitDef } from '../src/data/index';
import type { LightLevel, WindLevel } from '../src/data/schema';
import { addSplit, applyOnHit, armorRoll, hitChance, typeMult } from '../src/sim/combat';
import { addZone, darkWinsAt, lightAt, windAt } from '../src/sim/zones';
import { effectiveRange, weaponOf } from '../src/sim/missiles';
import { createUnit } from '../src/sim/army';
import type { Battle } from '../src/sim/battle';
import type { Unit } from '../src/sim/types';
import { makeBattle, stepSeconds, unitOf } from './helpers';

const LIGHTS: LightLevel[] = [0, 1, 2, 3, 4];
/** Rule checks don't need a full battlefield; a small map keeps terrain generation cheap. */
const SMALL = { width: 480, height: 400 };

describe('combat math: hit chance', () => {
  it('is min(0.90, max(0.08, 0.35 + (MA − MD) / 100)), exactly, over a grid of MA and MD', () => {
    const bad: string[] = [];
    for (let ma = 0; ma <= 130; ma++) {
      for (let md = 0; md <= 130; md += 1) {
        const want = Math.min(0.9, Math.max(0.08, 0.35 + (ma - md) / 100));
        if (hitChance(ma, md) !== want) bad.push(`hitChance(${ma}, ${md}) = ${hitChance(ma, md)} != ${want}`);
      }
    }
    const r = new Rng('hit');
    for (let i = 0; i < 5000; i++) {
      const ma = r.range(-20, 150);
      const md = r.range(-20, 150);
      const want = Math.min(0.9, Math.max(0.08, 0.35 + (ma - md) / 100));
      if (hitChance(ma, md) !== want) bad.push(`hitChance(${ma}, ${md})`);
    }
    expect(bad.slice(0, 5)).toEqual([]);
  });

  it('matches worked examples and clamps at 8% and 90%', () => {
    expect(hitChance(40, 40)).toBeCloseTo(0.35, 12);
    expect(hitChance(60, 30)).toBeCloseTo(0.65, 12);
    expect(hitChance(30, 56)).toBeCloseTo(0.09, 12);
    expect(hitChance(30, 57)).toBe(0.08);
    expect(hitChance(0, 200)).toBe(0.08);
    expect(hitChance(94, 39)).toBe(0.9);
    expect(hitChance(200, 0)).toBe(0.9);
    expect(COMBAT.hitBase).toBe(0.35);
    expect(COMBAT.hitMin).toBe(0.08);
    expect(COMBAT.hitMax).toBe(0.9);
  });
});

describe('combat math: armor roll D = B(1 − uA/100) + AP, u ~ U(0.5, 1)', () => {
  it('always lies within [B(1 − A/100) + AP, B(1 − 0.5A/100) + AP]', () => {
    const r = new Rng('armor-cases');
    const rng = new Rng('armor-rolls');
    const bad: string[] = [];
    for (let c = 0; c < 3000; c++) {
      const B = r.range(0, 150);
      const AP = r.range(0, 80);
      const A = c % 10 === 0 ? r.pick([0, 50, 100]) : r.range(0, 100);
      const lo = B * (1 - A / 100) + AP;
      const hi = B * (1 - (0.5 * A) / 100) + AP;
      for (let k = 0; k < 20; k++) {
        const d = armorRoll(rng, B, AP, A);
        if (d < lo - 1e-9 || d > hi + 1e-9) bad.push(`armorRoll(${B}, ${AP}, ${A}) = ${d} not in [${lo}, ${hi}]`);
      }
    }
    expect(bad.slice(0, 5)).toEqual([]);
  });

  it('spreads evenly between the bounds: the mean sits at u = 0.75 and both ends are reached', () => {
    const rng = new Rng('armor-mean');
    const B = 60;
    const AP = 12;
    const A = 80;
    const lo = B * (1 - A / 100) + AP;
    const hi = B * (1 - (0.5 * A) / 100) + AP;
    let sum = 0;
    let min = Infinity;
    let max = -Infinity;
    const n = 100_000;
    for (let i = 0; i < n; i++) {
      const d = armorRoll(rng, B, AP, A);
      sum += d;
      min = Math.min(min, d);
      max = Math.max(max, d);
    }
    expect(sum / n).toBeCloseTo(B * (1 - (0.75 * A) / 100) + AP, 1);
    expect(min - lo).toBeLessThan(0.01);
    expect(hi - max).toBeLessThan(0.01);
  });

  it('is exactly B + AP against no armor, and caps armor at 100', () => {
    const rng = new Rng('armor-edges');
    for (let i = 0; i < 100; i++) expect(armorRoll(rng, 30, 7, 0)).toBe(37);
    for (let i = 0; i < 1000; i++) {
      const d = armorRoll(rng, 40, 5, 250);
      expect(d).toBeGreaterThanOrEqual(5);
      expect(d).toBeLessThanOrEqual(25);
    }
  });

  it('draws exactly one random number per roll', () => {
    const a = new Rng('one-draw');
    const b = new Rng('one-draw');
    armorRoll(a, 50, 10, 40);
    b.next();
    expect(a.getState()).toEqual(b.getState());
  });

  it('bonus damage (vs large, charge) is split between base and AP in their ratio', () => {
    const [b1, a1] = addSplit(30, 10, 20);
    expect(b1 + a1).toBeCloseTo(60, 12);
    expect(b1 / a1).toBeCloseTo(3, 12);
    expect(addSplit(0, 0, 12)).toEqual([12, 0]);
  });
});

describe('damage type multipliers', () => {
  const unit = (id: string): Unit => createUnit(0, unitDef(id), 0, { def: id }, 1);

  it('Brittle units take +50% from cold and resonance only', () => {
    const saints = unit('choir.moltenSaints');
    expect(typeMult('cold', saints)).toBe(1.5);
    expect(typeMult('resonance', saints)).toBe(1.5);
    expect(typeMult('fire', saints)).toBe(1);
    expect(typeMult('normal', saints)).toBe(1);
    expect(typeMult('cold', unit('vesperate.hourLevy'))).toBe(1);
  });

  it('fire vulnerability scales fire damage by its percentage', () => {
    expect(typeMult('fire', unit('hush.umbralMother'))).toBe(2);
    expect(typeMult('fire', unit('hush.duskMothRiders'))).toBe(1.5);
    expect(typeMult('fire', unit('drift.galewings'))).toBe(1.25);
    expect(typeMult('normal', unit('hush.umbralMother'))).toBe(1);
  });
});

describe('light: the doc tables', () => {
  it('beams scale from 130% in Blaze to 20% in Dark', () => {
    expect(LIGHTS.map((l) => beamMult(l))).toEqual([0.2, 0.5, 1, 1.15, 1.3]);
  });

  it('glare is -20% accuracy and -4 MA at Dusk, -10% at Bright, none otherwise; spotting -25% Dim, -50% Dark', () => {
    expect(LIGHTS.map((l) => LIGHT_RULES[l].glareAccuracyPct)).toEqual([0, 0, -20, -10, 0]);
    expect(LIGHTS.map((l) => LIGHT_RULES[l].glareMa)).toEqual([0, 0, -4, 0, 0]);
    expect(LIGHTS.map((l) => LIGHT_RULES[l].spotMult)).toEqual([0.5, 0.75, 1, 1, 1]);
  });

  it('wind: Breeze +10% range, Gale +20% range and -5% accuracy', () => {
    expect(([0, 1, 2] as WindLevel[]).map((w) => WIND_RULES[w].rangePct)).toEqual([0, 10, 20]);
    expect(WIND_RULES[2].accuracyPct).toBe(-5);
  });
});

describe('light zones: "the higher intensity wins; equal intensities cancel and the natural light returns"', () => {
  /** A quiet battle on a small map whose units stand far from the test point, so only our zones matter. */
  function quietBattle(light: LightLevel): Battle {
    return makeBattle({
      map: { band: 'gloaming', light, ...SMALL },
      armies: [
        { faction: 'vesperate', units: [{ def: 'vesperate.hourLevy', x: 440, y: 370 }] },
        { faction: 'choir', units: [{ def: 'choir.kilnAcolytes', x: 440, y: 30 }] },
      ],
    });
  }
  const quiet = new Map<LightLevel, Battle>();

  function lightWith(light: LightLevel, zones: string[], x = 200, y = 200): LightLevel {
    let b = quiet.get(light);
    if (!b) {
      b = quietBattle(light);
      quiet.set(light, b);
    }
    b.zones = [];
    zones.forEach((z, i) => addZone(b, z, (i % 2) as 0 | 1, x, y, 60));
    return lightAt(b, x, y);
  }

  it('returns the natural light when no zone covers the point', () => {
    for (const l of LIGHTS) expect(lightWith(l, [])).toBe(l);
  });

  it('Walking Noon (floor Bright, 3) and Eclipse (ceiling Dark, 3) cancel back to the natural light', () => {
    for (const l of LIGHTS) {
      expect(lightWith(l, ['walkingNoon', 'eclipse'])).toBe(l);
      expect(lightWith(l, ['eclipse', 'walkingNoon'])).toBe(l);
    }
  });

  it('Lantern (1) under a Veil (2) is Dark', () => {
    for (const l of LIGHTS) {
      expect(lightWith(l, ['lantern', 'veil'])).toBe(0);
      expect(lightWith(l, ['veil', 'lantern'])).toBe(0);
    }
  });

  it('a Sunpatch (2) on a Dark map is Bright', () => {
    expect(lightWith(0, ['sunpatch'])).toBe(3);
    expect(lightWith(1, ['sunpatch'])).toBe(3);
  });

  it('floors only brighten and ceilings only darken', () => {
    expect(lightWith(0, ['lantern'])).toBe(2);
    expect(lightWith(4, ['lantern'])).toBe(4);
    expect(lightWith(4, ['sunpatch'])).toBe(4);
    expect(lightWith(4, ['veil'])).toBe(0);
    expect(lightWith(0, ['veil'])).toBe(0);
  });

  it('the stronger zone wins whichever side cast it', () => {
    expect(lightWith(2, ['eclipse', 'sunpatch'])).toBe(0);
    expect(lightWith(2, ['walkingNoon', 'veil'])).toBe(3);
    // A weaker lantern does not tip a tie between equal floor and ceiling.
    expect(lightWith(2, ['sunpatch', 'lantern', 'veil'])).toBe(2);
    expect(lightWith(3, ['sunpatch', 'veil'])).toBe(3);
    expect(lightWith(1, ['sunpatch', 'veil'])).toBe(1);
    expect(lightWith(2, ['walkingNoon', 'sunpatch', 'eclipse', 'veil'])).toBe(2);
    expect(lightWith(2, ['walkingNoon', 'eclipse', 'veil'])).toBe(2);
  });

  it('applies only inside the radius (the edge counts) and ignores switched-off zones', () => {
    const b = quietBattle(0);
    expect(b.zones).toHaveLength(0);
    const z = addZone(b, 'sunpatch', 0, 200, 200, 60);
    expect(lightAt(b, 200 + 40, 200)).toBe(3);
    expect(lightAt(b, 200 + 40.001, 200)).toBe(0);
    expect(lightAt(b, 200, 200 - 39.9)).toBe(3);
    z.enabled = false;
    expect(lightAt(b, 200, 200)).toBe(0);
  });

  it('dark wins (the sun is hidden) only where a ceiling is strictly stronger', () => {
    const b = quietBattle(2);
    addZone(b, 'veil', 1, 200, 200, 60);
    addZone(b, 'lantern', 0, 200, 200, 60);
    expect(darkWinsAt(b, 200, 200)).toBe(true);
    addZone(b, 'sunpatch', 0, 200, 200, 60);
    expect(darkWinsAt(b, 200, 200)).toBe(false);
    expect(darkWinsAt(b, 100, 330)).toBe(false);
  });

  it('a Gust raises the wind one step, never beyond Gale', () => {
    for (const wind of [0, 1, 2] as WindLevel[]) {
      const b = makeBattle({
        map: { wind, ...SMALL },
        armies: [
          { faction: 'vesperate', units: [{ def: 'vesperate.hourLevy', x: 440, y: 370 }] },
          { faction: 'drift', units: [{ def: 'drift.reedspears', x: 440, y: 30 }] },
        ],
      });
      addZone(b, 'gust', 1, 150, 150, 40);
      expect(windAt(b, 150, 150)).toBe(Math.min(2, wind + 1));
      expect(windAt(b, 150, 251)).toBe(wind);
    }
  });
});

describe('wind and missile range', () => {
  const BEARINGS = [0, 1.1, -2.5, PI];

  function rangeBattle(wind: WindLevel, sunBearing: number): Battle {
    const b = makeBattle({
      map: { wind, sunBearing, ...SMALL },
      armies: [
        {
          faction: 'vesperate',
          units: [
            { def: 'vesperate.vesperArbalests', x: 80, y: 330 },
            { def: 'vesperate.counterweightEngine', x: 240, y: 330 },
            { def: 'vesperate.knellCannon', x: 400, y: 330 },
          ],
        },
        {
          faction: 'choir',
          units: [
            { def: 'choir.lenswrights', x: 80, y: 70 },
            { def: 'choir.heliostatBattery', x: 240, y: 70 },
            { def: 'choir.shardbows', x: 400, y: 70 },
          ],
        },
      ],
    });
    b.step();
    return b;
  }

  function rangeOf(b: Battle, u: Unit, dir: number): number {
    return effectiveRange(b, u, weaponOf(u)!, dir);
  }

  it('a shot straight downwind (toward the sun) gains 10% in a Breeze and 20% in a Gale; upwind loses as much', () => {
    for (const s of BEARINGS) {
      for (const wind of [0, 1, 2] as WindLevel[]) {
        const b = rangeBattle(wind, s);
        const pct = [0, 0.1, 0.2][wind]!;
        for (const id of ['vesperate.vesperArbalests', 'vesperate.counterweightEngine', 'choir.shardbows']) {
          const u = unitOf(b, id);
          expect(u.wind).toBe(wind);
          expect(u.stats.rangeMult).toBe(1);
          const base = weaponOf(u)!.range;
          expect(rangeOf(b, u, s)).toBeCloseTo(base * (1 + pct), 4);
          expect(rangeOf(b, u, s + PI)).toBeCloseTo(base * (1 - pct), 4);
        }
      }
    }
  });

  it('a crosswind shot keeps its range (within 1%)', () => {
    for (const s of BEARINGS) {
      for (const wind of [1, 2] as WindLevel[]) {
        const b = rangeBattle(wind, s);
        const u = unitOf(b, 'vesperate.vesperArbalests');
        for (const dir of [s + PI / 2, s - PI / 2]) {
          expect(Math.abs(rangeOf(b, u, dir) / 150 - 1)).toBeLessThan(0.01);
        }
        // In between, the effect grows smoothly with the downwind component.
        const quarter = rangeOf(b, u, s + PI / 3);
        expect(quarter).toBeCloseTo(150 * (1 + [0, 0.1, 0.2][wind]! * 0.5), 3);
      }
    }
  });

  it('beams, line beams and the Knell Cannon cone ignore wind entirely', () => {
    for (const s of BEARINGS) {
      for (const wind of [0, 1, 2] as WindLevel[]) {
        const b = rangeBattle(wind, s);
        for (const [id, range] of [
          ['choir.lenswrights', 190],
          ['choir.heliostatBattery', 400],
          ['vesperate.knellCannon', 150],
        ] as const) {
          const u = unitOf(b, id);
          for (const dir of [s, s + PI, s + PI / 2, s + 0.4]) expect(rangeOf(b, u, dir)).toBe(range);
        }
      }
    }
  });

  it('Firekites ride the wind: 350 m downwind and 150 m upwind before Windsworn, 200 m in Calm', () => {
    for (const s of BEARINGS) {
      for (const wind of [0, 1] as WindLevel[]) {
        const b = makeBattle({
          map: { wind, sunBearing: s, ...SMALL },
          armies: [
            { faction: 'drift', units: [{ def: 'drift.firekiteBattery', x: 240, y: 330 }] },
            { faction: 'choir', units: [{ def: 'choir.kilnAcolytes', x: 240, y: 60 }] },
          ],
        });
        b.step();
        const u = unitOf(b, 'drift.firekiteBattery');
        const mult = u.stats.rangeMult;
        if (wind === 0) {
          expect(mult).toBe(1);
          for (const dir of [s, s + PI, s + PI / 2]) expect(rangeOf(b, u, dir)).toBe(200);
        } else {
          // Windsworn: the Drift get +10% missile range in Breeze or Gale.
          expect(mult).toBeCloseTo(1.1, 12);
          expect(rangeOf(b, u, s) / mult).toBeCloseTo(350, 4);
          expect(rangeOf(b, u, s + PI) / mult).toBeCloseTo(150, 4);
          expect(rangeOf(b, u, s + PI / 2) / mult).toBeCloseTo(250, 4);
        }
      }
    }
  });
});

describe('glare', () => {
  const SUN = 0.7;

  function glareBattle(light: LightLevel): Battle {
    const b = makeBattle({
      map: { band: 'gloaming', light, sunBearing: SUN, ...SMALL },
      armies: [
        {
          faction: 'vesperate',
          units: [
            { def: 'vesperate.hourLevy', x: 60, y: 330, facing: SUN },
            { def: 'vesperate.hourLevy', x: 180, y: 330, facing: SUN + PI },
            { def: 'vesperate.hourLevy', x: 300, y: 330, facing: SUN + (44 * PI) / 180 },
            { def: 'vesperate.hourLevy', x: 420, y: 330, facing: SUN - (46 * PI) / 180 },
          ],
        },
        {
          faction: 'choir',
          units: [
            { def: 'choir.kilnAcolytes', x: 100, y: 70, facing: SUN },
            { def: 'hush.grueHunters', x: 350, y: 70, facing: SUN },
          ],
        },
      ],
    });
    b.step();
    return b;
  }

  it('a non-Choir unit facing the sun: -20% accuracy and -4 MA at Dusk, -10% and 0 at Bright, none in Blaze, Dim or Dark', () => {
    const want: Record<LightLevel, [number, number]> = { 0: [0, 0], 1: [0, 0], 2: [-20, -4], 3: [-10, 0], 4: [0, 0] };
    for (const l of LIGHTS) {
      const b = glareBattle(l);
      const u = b.units[0]!;
      expect(u.facing).toBe(SUN);
      expect([u.stats.glareAcc, u.stats.glareMa], `light ${l}`).toEqual(want[l]);
      expect(u.stats.glareSource).toBe(want[l][0] ? 'sun' : 'none');
    }
  });

  it('glare applies within 45° of the sun and not beyond, and never with the sun at your back', () => {
    for (const l of [2, 3] as LightLevel[]) {
      const b = glareBattle(l);
      expect(b.units[1]!.stats.glareAcc, 'back to the sun').toBe(0);
      expect(b.units[2]!.stats.glareAcc, '44° off').toBe(LIGHT_RULES[l].glareAccuracyPct);
      expect(b.units[3]!.stats.glareAcc, '46° off').toBe(0);
    }
  });

  it('Choir units (Glassblind) and Grue Hunters (blind) never suffer glare', () => {
    for (const l of LIGHTS) {
      const b = glareBattle(l);
      for (const id of ['choir.kilnAcolytes', 'hush.grueHunters']) {
        const u = unitOf(b, id);
        expect(u.facing).toBe(SUN);
        expect([u.stats.glareAcc, u.stats.glareMa], `${id} in light ${l}`).toEqual([0, 0]);
      }
    }
  });

  it('a winning dark zone hides the sun: no glare inside an Eclipse at Dusk', () => {
    const b = glareBattle(2);
    const u = b.units[0]!;
    addZone(b, 'eclipse', 1, u.x, u.y, 30);
    b.step();
    expect(u.stats.glareAcc).toBe(0);
    expect(u.light).toBe(0);
  });

  it('Walking Noon glares enemies who face the Nailbearer, even on a Dark map', () => {
    const b = makeBattle({
      map: { band: 'evernight', sunBearing: 0, ...SMALL },
      armies: [
        {
          faction: 'hush',
          units: [
            { def: 'hush.rimeguard', x: 200, y: 300, facing: -PI / 2 },
            { def: 'hush.rimeguard', x: 400, y: 300, facing: PI / 2 },
          ],
        },
        { faction: 'choir', units: [{ def: 'choir.nailbearer', x: 200, y: 180, facing: PI / 2 }] },
      ],
    });
    b.step();
    const facing = b.units[0]!;
    const away = b.units[1]!;
    expect(b.terrain.light).toBe(0);
    expect([facing.stats.glareAcc, facing.stats.glareMa, facing.stats.glareSource]).toEqual([-20, -4, 'noon']);
    expect(away.stats.glareAcc).toBe(0);
  });
});

describe('on-hit status effects', () => {
  function statusBattle(): Battle {
    const b = makeBattle({
      map: { ...SMALL },
      armies: [
        {
          faction: 'choir',
          units: [
            { def: 'choir.kilnbackLancers', x: 240, y: 330 },
            { def: 'vesperate.hourLevy', x: 80, y: 330 },
          ],
        },
        { faction: 'hush', units: [{ def: 'hush.rimeguard', x: 240, y: 60 }] },
      ],
    });
    b.step();
    return b;
  }

  it('slows: the stronger one wins while active, large-only slows skip small units, and an expired slow is forgotten', () => {
    const b = statusBattle();
    const lancers = unitOf(b, 'choir.kilnbackLancers');
    const levy = unitOf(b, 'vesperate.hourLevy');
    const from = unitOf(b, 'hush.rimeguard');
    const s = lancers.soldiers[0]!;
    // Whalebreaker tether: 50% for 12 s on large targets only.
    applyOnHit(b, [{ kind: 'slow', pct: 50, duration: 12, largeOnly: true }], levy.soldiers[0]!, from, 0, 0);
    expect(levy.slow).toBe(0);
    applyOnHit(b, [{ kind: 'slow', pct: 50, duration: 12, largeOnly: true }], s, from, s.x, s.y);
    applyOnHit(b, [{ kind: 'slow', pct: 40, duration: 8 }], s, from, s.x, s.y);
    b.step();
    expect(lancers.slowPct).toBe(50);
    expect(lancers.stats.speedMult).toBeCloseTo(0.5, 12);
    stepSeconds(b, 13);
    expect(lancers.slow).toBeLessThanOrEqual(0);
    expect(lancers.stats.speedMult).toBe(1);
    // Dustrunner bolas afterwards: a fresh 40% slow, not the old 50%.
    applyOnHit(b, [{ kind: 'slow', pct: 40, duration: 8 }], s, from, s.x, s.y);
    b.step();
    expect(lancers.slowPct).toBe(40);
    expect(lancers.stats.speedMult).toBeCloseTo(0.6, 12);
  });

  it('burns: a new burn after an old one has gone out burns at its own rate', () => {
    const b = statusBattle();
    const levy = unitOf(b, 'vesperate.hourLevy');
    const from = unitOf(b, 'hush.rimeguard');
    const t = levy.soldiers[0]!;
    // Anvil-Walker: 4 dps for 4 s.
    applyOnHit(b, [{ kind: 'burn', dps: 4, duration: 4 }], t, from, t.x, t.y);
    expect(t.burnDps).toBe(4);
    stepSeconds(b, 5);
    expect(t.burn).toBeLessThanOrEqual(0);
    // Cinder Penitents: 2 dps for 3 s, so 6 damage in all.
    const hp0 = t.hp;
    applyOnHit(b, [{ kind: 'burn', dps: 2, duration: 3 }], t, from, t.x, t.y);
    expect(t.burnDps).toBe(2);
    stepSeconds(b, 4);
    expect(hp0 - t.hp).toBeCloseTo(6, 9);
  });
});
