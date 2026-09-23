/**
 * Regression tests for the balance pass's simulation fixes: soldiers trapped on
 * impassable ground, formations that stopped moving, pursuit of routers, the
 * valuation of hurt units at the time limit, broken armies, melee slots around
 * big bodies, wound shock and burning ground.
 */
import { describe, expect, it } from 'vitest';
import { Battle, VICTORY } from '../src/sim/battle';
import { COVER, Terrain } from '../src/sim/terrain';
import type { MapSetup } from '../src/sim/terrain';
import { meleeSlots } from '../src/sim/melee';
import { applyDamage } from '../src/sim/combat';
import { unitHpShare } from '../src/sim/army';
import { addZone } from '../src/sim/zones';
import { rout } from '../src/sim/morale';
import { MORALE } from '../src/data/rules';
import { unitDef } from '../src/data/index';
import { BattleAI } from '../src/ai/battleAI';
import { makeBattle, makeSetup, stepSeconds, stepUntil } from './helpers';

const MAP: MapSetup = { seed: 5, band: 'gloaming', wind: 0, sunBearing: 0, preset: 'default' };

/** A building cell well away from both deployment zones, found by scanning the generated map. */
function buildingCell(t: Terrain): { x: number; y: number } {
  for (let y = t.height * 0.35; y < t.height * 0.65; y += 2) {
    for (let x = 100; x < t.width - 100; x += 2) {
      if (t.coverAt(x, y) === COVER.Building && t.coverAt(x + 2, y) === COVER.Building && t.coverAt(x, y + 2) === COVER.Building) return { x, y };
    }
  }
  throw new Error('no building on the test map');
}

describe('impassable ground', () => {
  it('soldiers placed inside a building start on open ground next to where they were put', () => {
    const at = buildingCell(new Terrain(MAP));
    const b = makeBattle({
      map: MAP,
      armies: [
        { faction: 'vesperate', units: [{ def: 'vesperate.hourLevy', x: at.x, y: at.y }] },
        { faction: 'choir', units: [{ def: 'choir.kilnAcolytes', x: 700, y: 60 }] },
      ],
    });
    const u = b.units[0]!;
    for (const s of u.soldiers) {
      expect(b.terrain.passable(s.x, s.y, 'infantry'), `soldier ${s.id} at ${s.x},${s.y}`).toBe(true);
      expect(Math.hypot(s.x - at.x, s.y - at.y)).toBeLessThan(80);
    }
  });

  it('a soldier that finds itself on impassable ground walks out instead of being stuck for good', () => {
    const b = makeBattle({
      armies: [
        { faction: 'vesperate', units: [{ def: 'vesperate.hourLevy', x: 700, y: 600 }] },
        { faction: 'choir', units: [{ def: 'choir.kilnAcolytes', x: 700, y: 60 }] },
      ],
    });
    const u = b.units[0]!;
    const s = u.soldiers[0]!;
    // A wall of rubble falls around one soldier: 5 cells in every direction become a building.
    for (let dy = -20; dy <= 20; dy += 4) for (let dx = -20; dx <= 20; dx += 4) b.terrain.cover[b.terrain.idx(s.x + dx, s.y + dy)] = COVER.Building;
    expect(b.terrain.passable(s.x, s.y, 'infantry')).toBe(false);
    b.issue(0, { type: 'move', unit: u.id, x: 700, y: 450, run: true });
    stepSeconds(b, 30);
    expect(b.terrain.passable(s.x, s.y, 'infantry')).toBe(true);
    expect(s.y).toBeLessThan(560);
  });
});

describe('formations keep moving', () => {
  it("soldiers stop chasing a routed enemy their unit wasn't sent after, and the unit re-forms and marches on", () => {
    const b = makeBattle({
      armies: [
        { faction: 'vesperate', units: [{ def: 'vesperate.hourLevy', x: 700, y: 600 }] },
        { faction: 'choir', units: [{ def: 'choir.kilnAcolytes', x: 700, y: 560 }, { def: 'choir.kilnAcolytes', x: 150, y: 100 }] },
      ],
    });
    const u = b.units[0]!;
    const enemy = b.units[1]!;
    b.step();
    rout(b, enemy);
    // Every soldier was running after a routing enemy soldier when the order came.
    u.soldiers.forEach((s, i) => (s.approach = enemy.soldiers[i % enemy.soldiers.length]!));
    b.issue(0, { type: 'move', unit: u.id, x: 1000, y: 600, run: true });
    stepSeconds(b, 3);
    const chasing = u.soldiers.filter((s) => s.alive && s.approach && s.approach.unit === enemy).length;
    expect(chasing).toBe(0);
    expect(stepUntil(b, () => u.order.kind === 'hold', 20 * 120)).toBe(true);
    expect(Math.hypot(u.x - 1000, u.y - 600)).toBeLessThan(5);
  });

  it('a formation scattered far from its slots re-forms where its soldiers are instead of freezing', () => {
    const b = makeBattle({
      armies: [
        { faction: 'vesperate', units: [{ def: 'vesperate.hourLevy', x: 700, y: 600 }] },
        { faction: 'choir', units: [{ def: 'choir.kilnAcolytes', x: 150, y: 100 }] },
      ],
    });
    const u = b.units[0]!;
    b.issue(0, { type: 'move', unit: u.id, x: 700, y: 300, run: true });
    b.step();
    // Scatter the unit 80 m to the east of its anchor.
    for (const s of u.soldiers) s.x += 80;
    b.rebuildHash();
    stepSeconds(b, 1);
    // The anchor moved to the soldiers rather than waiting for them.
    expect(u.x).toBeGreaterThan(740);
    expect(stepUntil(b, () => u.order.kind === 'hold', 20 * 120)).toBe(true);
    expect(Math.hypot(u.x - 700, u.y - 300)).toBeLessThan(5);
  });
});

describe('valuing units that are still fighting', () => {
  it('a hurt colossus counts for the hit points it has left', () => {
    const b = makeBattle({
      armies: [
        { faction: 'choir', units: [{ def: 'choir.nailbearer', x: 700, y: 800 }] },
        { faction: 'vesperate', units: [{ def: 'vesperate.hourLevy', x: 700, y: 100 }] },
      ],
    });
    const n = b.units[0]!.soldiers[0]!;
    n.hp = n.maxHp * 0.3;
    expect(unitHpShare(b.units[0]!)).toBeCloseTo(0.3, 9);
    expect(b.remainingValue(0)).toBeCloseTo(0.3, 9);
    expect(b.remainingValue(1)).toBeCloseTo(1, 9);
  });

  it('on the timer, a badly hurt colossus loses to a smaller force that is still whole', () => {
    const b = makeBattle({
      timeLimit: 5,
      map: { preset: 'open' },
      armies: [
        { faction: 'choir', units: [{ def: 'choir.nailbearer', x: 700, y: 900 }] },
        { faction: 'vesperate', units: [{ def: 'vesperate.hourLevy', x: 300, y: 100 }, { def: 'vesperate.hourLevy', x: 1100, y: 100 }] },
      ],
    });
    // Just above the army-broken threshold, so only the timer can decide.
    const n = b.units[0]!.soldiers[0]!;
    n.hp = n.maxHp * (VICTORY.brokenBelow + 0.02);
    const r = b.run();
    expect(r.reason).toBe('timeout');
    expect(r.winner).toBe(1);
  });
});

describe('broken armies', () => {
  it('an army down to a remnant while the enemy holds the field breaks before the time limit', () => {
    const b = makeBattle({
      timeLimit: 600,
      map: { preset: 'open' },
      armies: [
        { faction: 'vesperate', units: [{ def: 'vesperate.hourLevy', x: 300, y: 900 }, { def: 'vesperate.hourLevy', x: 1100, y: 900 }] },
        { faction: 'choir', units: [{ def: 'choir.kilnAcolytes', x: 700, y: 100 }] },
      ],
    });
    for (const u of b.army(0)) for (const s of u.soldiers) s.hp = s.maxHp * 0.15;
    const r = b.run();
    expect(r.reason).toBe('rout');
    expect(r.winner).toBe(1);
    expect(r.time).toBeLessThan(5);
  });

  it('two armies worn down alike keep fighting', () => {
    const b = makeBattle({
      timeLimit: 10,
      map: { preset: 'open' },
      armies: [
        { faction: 'vesperate', units: [{ def: 'vesperate.hourLevy', x: 300, y: 900 }] },
        { faction: 'choir', units: [{ def: 'choir.kilnAcolytes', x: 700, y: 100 }] },
      ],
    });
    for (const u of b.units) for (const s of u.soldiers) s.hp = s.maxHp * 0.2;
    const r = b.run();
    expect(r.reason).toBe('timeout');
  });
});

describe('melee around big bodies', () => {
  it('no more soldiers fight a monster at once than fit in one ring around it', () => {
    const b = makeBattle({
      map: { preset: 'open' },
      armies: [
        { faction: 'choir', units: [{ def: 'choir.moltenSaints', x: 700, y: 500 }] },
        { faction: 'vesperate', units: [{ def: 'vesperate.lanternGuard', x: 700, y: 520 }, { def: 'vesperate.lanternGuard', x: 700, y: 480 }] },
      ],
      unitScale: 1,
    });
    for (const u of b.army(1)) b.issue(1, { type: 'attack', unit: u.id, target: 0 });
    let most = 0;
    for (let t = 0; t < 20 * 8; t++) {
      b.step();
      for (const g of b.units[0]!.soldiers) {
        if (!g.alive) continue;
        const n = b.soldiers.filter((s) => s.alive && s.target === g).length;
        expect(n).toBeLessThanOrEqual(meleeSlots(g));
        most = Math.max(most, n);
      }
    }
    // The ring does fill up.
    expect(most).toBeGreaterThan(meleeSlots(b.units[0]!.soldiers[0]!) / 2);
  });
});

describe('morale counts wounds', () => {
  it('a unit that loses half its hit points to wounds loses morale as if half of it had fallen', () => {
    const b = makeBattle({
      armies: [
        { faction: 'vesperate', units: [{ def: 'vesperate.hourLevy', x: 700, y: 800 }] },
        { faction: 'choir', units: [{ def: 'choir.kilnAcolytes', x: 700, y: 100 }] },
      ],
    });
    const u = b.units[0]!;
    const before = u.morale;
    for (const s of u.soldiers) applyDamage(b, s, s.maxHp / 2, null, 'normal', null);
    expect(u.alive).toBe(u.initial);
    expect(before - u.morale).toBeCloseTo((MORALE.casualtyShock / 100) * u.maxMorale * 0.5, 6);
  });

  it('a routing unit with less than a quarter of its strength left shatters instead of rallying', () => {
    const b = makeBattle({
      armies: [
        { faction: 'vesperate', units: [{ def: 'vesperate.hourLevy', x: 700, y: 700 }, { def: 'vesperate.hourLevy', x: 150, y: 900 }] },
        { faction: 'choir', units: [{ def: 'choir.kilnAcolytes', x: 700, y: 60 }] },
      ],
    });
    const u = b.units[0]!;
    for (const s of u.soldiers) s.hp = s.maxHp * 0.2;
    u.morale = -1;
    b.step();
    expect(u.state).toBe('shattered');
  });
});

describe('burning ground', () => {
  it('soldiers who are not fighting step out of the fire', () => {
    const b = makeBattle({
      map: { preset: 'open' },
      armies: [
        { faction: 'vesperate', units: [{ def: 'vesperate.hourLevy', x: 700, y: 600 }] },
        { faction: 'choir', units: [{ def: 'choir.kilnAcolytes', x: 700, y: 60 }] },
      ],
    });
    const u = b.units[0]!;
    const z = addZone(b, 'burning', 1, u.x, u.y, 30);
    z.radius = 10;
    const inside = (): number => u.soldiers.filter((s) => s.alive && Math.hypot(s.x - z.x, s.y - z.y) < z.radius).length;
    const before = inside();
    expect(before).toBeGreaterThan(20);
    stepSeconds(b, 6);
    expect(inside()).toBeLessThan(before / 4);
  });

  it('armor turns part of the heat, and fire vulnerability applies to it', () => {
    const hot = (def: string): number => {
      const b = makeBattle({
        map: { preset: 'open' },
        armies: [
          { faction: unitDef(def).faction, units: [{ def, x: 700, y: 600 }] },
          { faction: 'vesperate', units: [{ def: 'vesperate.hourLevy', x: 700, y: 60 }] },
        ],
      });
      const s = b.units[0]!.soldiers[0]!;
      const hp = s.hp;
      addZone(b, 'burning', 1, s.x, s.y, 30).radius = 0.5;
      b.soldiers.forEach((o) => {
        if (o !== s) o.x += 200;
      });
      b.rebuildHash();
      for (let i = 0; i < 10; i++) b.step();
      return hp - s.hp;
    };
    const plain = hot('drift.windbows'); // armor 12
    const armored = hot('vesperate.lanternGuard'); // armor 58
    expect(armored).toBeLessThan(plain);
    expect(armored).toBeGreaterThan(0);
  });

  it('overlapping fires do not stack: a soldier burns in the hottest one only', () => {
    const burn = (fires: number): number => {
      const b = makeBattle({
        map: { preset: 'open' },
        armies: [
          { faction: 'drift', units: [{ def: 'drift.windbows', x: 700, y: 600 }] },
          { faction: 'vesperate', units: [{ def: 'vesperate.hourLevy', x: 700, y: 60 }] },
        ],
      });
      const s = b.units[0]!.soldiers[0]!;
      const hp = s.hp;
      for (let k = 0; k < fires; k++) addZone(b, 'burning', 1, s.x, s.y, 30).radius = 0.5;
      b.soldiers.forEach((o) => {
        if (o !== s) o.x += 200;
      });
      b.rebuildHash();
      for (let i = 0; i < 10; i++) b.step();
      return hp - s.hp;
    };
    const one = burn(1);
    expect(one).toBeGreaterThan(0);
    expect(burn(6)).toBeCloseTo(one, 9);
  });
});

describe('fortified battles', () => {
  const FORT: Partial<MapSetup> = { preset: 'open', fort: { defender: 1, radius: 170 } };
  const outside = (b: Battle, i: number) => b.units[i]!.soldiers.every((s) => !s.alive || !b.terrain.insideFort(s.x, s.y));

  it('a routing defender slips out through one of its own gates, even on horseback', () => {
    const b = makeBattle({
      map: FORT,
      armies: [
        { faction: 'vesperate', units: [{ def: 'vesperate.hourLevy', x: 700, y: 950 }] },
        { faction: 'choir', units: [{ def: 'choir.heliographerRiders', x: 700, y: 440 }, { def: 'choir.kilnAcolytes', x: 700, y: 560 }] },
      ],
    });
    const u = b.units[1]!;
    expect(b.terrain.insideFort(u.x, u.y)).toBe(true);
    b.step();
    // Shattered, so it runs for good rather than rallying.
    u.routs = MORALE.shatterRouts - 1;
    rout(b, u);
    expect(u.state).toBe('shattered');
    // Riders cannot climb, and every wall and gate is standing: the only way out is a gate.
    expect(b.terrain.walls.some((w) => w.broken)).toBe(false);
    expect(stepUntil(b, () => outside(b, 1), 20 * 90)).toBe(true);
  });

  it('an attacker routing inside the walls climbs out over a wall instead of pressing against a shut gate', () => {
    const b = makeBattle({
      map: FORT,
      armies: [
        { faction: 'vesperate', units: [{ def: 'vesperate.hourLevy', x: 745, y: 385 }, { def: 'vesperate.hourLevy', x: 700, y: 950 }] },
        { faction: 'choir', units: [{ def: 'choir.kilnAcolytes', x: 700, y: 560 }] },
      ],
    });
    const u = b.units[0]!;
    expect(b.terrain.insideFort(u.x, u.y)).toBe(true);
    b.step();
    u.routs = MORALE.shatterRouts - 1;
    rout(b, u);
    expect(stepUntil(b, () => outside(b, 0), 20 * 120)).toBe(true);
  });

  it('an assault that has spent itself against the walls is called off', () => {
    const b = makeBattle({
      timeLimit: 600,
      map: FORT,
      armies: [
        { faction: 'vesperate', units: [{ def: 'vesperate.hourLevy', x: 500, y: 900 }, { def: 'vesperate.hourLevy', x: 900, y: 900 }] },
        { faction: 'choir', units: [{ def: 'choir.kilnAcolytes', x: 700, y: 500 }] },
      ],
    });
    for (const u of b.army(0)) for (const s of u.soldiers) s.hp = s.maxHp * 0.15;
    const r = b.run();
    expect(r.reason).toBe('rout');
    expect(r.winner).toBe(1);
    expect(r.time).toBeLessThan(5);
  });

  it('a siege in which nothing happens for two minutes ends with the attacker withdrawing', () => {
    const b = makeBattle({
      timeLimit: 1500,
      map: FORT,
      armies: [
        { faction: 'vesperate', units: [{ def: 'vesperate.hourLevy', x: 300, y: 950 }] },
        { faction: 'choir', units: [{ def: 'choir.kilnAcolytes', x: 700, y: 500 }] },
      ],
    });
    const r = b.run();
    expect(r.reason).toBe('withdraw');
    expect(r.winner).toBe(1);
    expect(r.time).toBeGreaterThan(VICTORY.siegeStall);
    expect(r.time).toBeLessThan(VICTORY.siegeStall + 10);
  });

  it('the attacking AI gathers its line at one gate and batters it down', () => {
    const b = makeBattle({
      timeLimit: 600,
      map: FORT,
      armies: [
        {
          faction: 'vesperate',
          controller: 'ai',
          units: [
            { def: 'vesperate.hourLevy', x: 560, y: 930 },
            { def: 'vesperate.lanternGuard', x: 700, y: 930 },
            { def: 'vesperate.hourLevy', x: 840, y: 930 },
          ],
        },
        { faction: 'choir', controller: 'ai', units: [{ def: 'choir.kilnAcolytes', x: 700, y: 520 }] },
      ],
    });
    b.setController(0, new BattleAI());
    b.setController(1, new BattleAI());
    expect(stepUntil(b, () => b.terrain.walls.some((w) => w.broken), 20 * 300)).toBe(true);
    const broken = b.terrain.walls.filter((w) => w.broken);
    expect(broken.length).toBe(1);
    expect(broken[0]!.gate).toBe(true);
  });
});

describe('setup', () => {
  it('the balance changes keep a setup with explicit positions deterministic', () => {
    const setup = makeSetup({
      map: MAP,
      armies: [
        { faction: 'vesperate', controller: 'ai', units: ['vesperate.maren', 'vesperate.hourLevy', 'vesperate.lanternGuard'] },
        { faction: 'hush', controller: 'ai', units: ['hush.queenYsh', 'hush.glowkinLurers', 'hush.rimeguard'] },
      ],
    });
    const a = new Battle(setup);
    const c = new Battle(setup);
    stepSeconds(a, 20);
    stepSeconds(c, 20);
    expect(a.soldiers.map((s) => `${s.x},${s.y},${s.hp}`)).toEqual(c.soldiers.map((s) => `${s.x},${s.y},${s.hp}`));
  });
});
