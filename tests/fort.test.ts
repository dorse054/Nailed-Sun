/**
 * Towers and siege towers in fortified battles.
 */
import { describe, expect, it } from 'vitest';
import type { MapSetup } from '../src/sim/terrain';
import { Terrain } from '../src/sim/terrain';
import { makeBattle, stepSeconds, stepUntil } from './helpers';

const FORT: Partial<MapSetup> = { preset: 'open', fort: { defender: 1, radius: 170 } };
/** The same map the battle builds, to find its walls and towers. */
const fortTerrain = () => new Terrain({ seed: 1, band: 'gloaming', wind: 0, sunBearing: 0, preset: 'open', fort: { defender: 1, radius: 170 } });

describe('fortified battles: towers and docking', () => {
  it('towers shoot attackers who come within range', () => {
    const t = fortTerrain();
    const tower = t.walls.find((w) => w.tower)!;
    // Out along the line from the town's centre through the tower, 90 m outside it.
    const cx = t.width / 2;
    const cy = t.height / 2;
    const d = Math.sqrt((tower.x1 - cx) ** 2 + (tower.y1 - cy) ** 2);
    const x = tower.x1 + ((tower.x1 - cx) / d) * 90;
    const y = tower.y1 + ((tower.y1 - cy) / d) * 90;
    const b = makeBattle({
      map: FORT,
      armies: [
        { faction: 'vesperate', units: [{ def: 'vesperate.hourLevy', x, y }] },
        // A lord with no bow at the far side of town: only the towers can shoot.
        { faction: 'choir', units: [{ def: 'choir.oriel', x: 2 * cx - tower.x1 * 0.2 - cx * 0.8, y: cy }] },
      ],
    });
    const levy = b.units[0]!;
    const hp = () => levy.soldiers.reduce((a, s) => a + (s.alive ? s.hp : 0), 0);
    const before = hp();
    stepSeconds(b, 12);
    // A tower wears a unit down; it does not sweep it away.
    expect(hp()).toBeLessThan(before * 0.95);
    expect(hp()).toBeGreaterThan(before * 0.5);
    expect(b.units[1]!.damageDealt).toBeGreaterThan(0);
  });

  it('towers stay silent once no defender is left to man them', () => {
    const t = fortTerrain();
    const tower = t.walls.find((w) => w.tower)!;
    const b = makeBattle({
      map: FORT,
      armies: [
        { faction: 'vesperate', units: [{ def: 'vesperate.hourLevy', x: tower.x1 + 60, y: tower.y1 }] },
        { faction: 'choir', units: [{ def: 'choir.oriel', x: t.width / 2, y: t.height / 2 }] },
      ],
    });
    const lord = b.units[1]!;
    for (const s of lord.soldiers) s.alive = false;
    lord.alive = 0;
    const levy = b.units[0]!;
    const before = levy.alive;
    stepSeconds(b, 3);
    expect(b.projectiles.length).toBe(0);
    expect(levy.alive).toBe(before);
  });

  it('Old Midnight docks against a wall and lets its garrison out inside the walls', () => {
    const t = fortTerrain();
    const cx = t.width / 2;
    const cy = t.height / 2;
    const wall = t.walls.find((w) => !w.tower && !w.gate)!;
    const mx = (wall.x1 + wall.x2) / 2;
    const my = (wall.y1 + wall.y2) / 2;
    const d = Math.sqrt((mx - cx) ** 2 + (my - cy) ** 2);
    // Just outside the wall, facing it.
    const x = mx + ((mx - cx) / d) * 16;
    const y = my + ((my - cy) / d) * 16;
    const b = makeBattle({
      map: FORT,
      armies: [
        { faction: 'vesperate', units: [{ def: 'vesperate.maren', x: x + 60, y: y + 60 }, { def: 'vesperate.oldMidnight', x, y }, { def: 'vesperate.vesperArbalests', x: x + 20, y: y + 20 }] },
        { faction: 'choir', units: [{ def: 'choir.oriel', x: cx, y: cy }] },
      ],
    });
    const tower = b.units[1]!;
    const bows = b.units[2]!;
    b.step();
    b.embark(bows, tower);
    expect(bows.state).toBe('embarked');
    expect(b.terrain.insideFort(bows.x, bows.y)).toBe(false);
    expect(stepUntil(b, () => bows.state === 'ready', 20 * 5)).toBe(true);
    expect(tower.passengers.length).toBe(0);
    expect(b.terrain.insideFort(bows.x, bows.y)).toBe(true);
  });
});
