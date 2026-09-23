/**
 * The Legends are well formed: real units of the right factions, a lord
 * leading each side, and medals that follow the losses.
 */
import { describe, expect, it } from 'vitest';
import { LEGENDS, legendSetup, medalFor } from '../src/app/legends';
import { FACTIONS, hasUnit, unitDef } from '../src/data/index';
import { ARMY } from '../src/data/rules';
import type { BattleResult } from '../src/sim/types';

describe('legends', () => {
  it('field real units of the right factions, led by their lords', () => {
    for (const l of LEGENDS) {
      for (const [f, ids] of [
        [l.me, l.mine],
        [l.foe, l.theirs],
      ] as const) {
        expect(ids[0], l.id).toBe(FACTIONS[f].lord.id);
        for (const id of ids) {
          expect(hasUnit(id), `${l.id}: ${id}`).toBe(true);
          expect(unitDef(id).faction, `${l.id}: ${id}`).toBe(f);
        }
        expect(ids.length - 1).toBeLessThanOrEqual(ARMY.maxUnits);
        expect(ids.filter((id) => unitDef(id).role === 'colossus').length).toBeLessThanOrEqual(1);
      }
      expect(l.gold).toBeLessThan(l.silver);
      const setup = legendSetup(l, 1, 0.5);
      expect(setup.armies[0].controller).toBe('player');
      if (l.map.fort) expect(setup.attacker).toBe(l.map.fort.defender === 1 ? 0 : 1);
    }
    expect(new Set(LEGENDS.map((l) => l.id)).size).toBe(LEGENDS.length);
  });

  it('give medals by the share of soldiers lost, and none for a loss', () => {
    const l = LEGENDS[0]!;
    const result = (winner: 0 | 1 | -1, lost: number): BattleResult =>
      ({ winner, reason: 'rout', time: 100, sides: [{ soldiersStart: 100, soldiersLost: lost }, { soldiersStart: 100, soldiersLost: 90 }] }) as unknown as BattleResult;
    expect(medalFor(l, result(0, 5), 0)).toBe('gold');
    expect(medalFor(l, result(0, Math.round(l.gold * 100) + 1), 0)).toBe('silver');
    expect(medalFor(l, result(0, 90), 0)).toBe('bronze');
    expect(medalFor(l, result(1, 5), 0)).toBeNull();
    expect(medalFor(l, result(-1, 5), 0)).toBeNull();
  });
});
