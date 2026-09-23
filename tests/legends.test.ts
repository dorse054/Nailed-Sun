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

describe('the Daily Battle', () => {
  it('is the same all day, different from day to day, and within the rules', async () => {
    const { dailyLegend } = await import('../src/app/daily');
    const a = dailyLegend('2026-09-23');
    expect(dailyLegend('2026-09-23')).toEqual(a);
    const week = ['2026-09-24', '2026-09-25', '2026-09-26', '2026-09-27', '2026-09-28', '2026-09-29'].map(dailyLegend);
    expect(new Set([a, ...week].map((l) => JSON.stringify([l.me, l.foe, l.map, l.mine]))).size).toBe(7);
    for (const l of [a, ...week]) {
      expect(l.me).not.toBe(l.foe);
      expect(l.seed).toBeTypeOf('number');
      for (const [f, ids] of [
        [l.me, l.mine],
        [l.foe, l.theirs],
      ] as const) {
        expect(ids[0]).toBe(FACTIONS[f].lord.id);
        expect(ids.every((id) => unitDef(id).faction === f)).toBe(true);
        expect(ids.reduce((s, id) => s + unitDef(id).cost, 0)).toBeLessThanOrEqual(10000);
        expect(ids.length - 1).toBeLessThanOrEqual(ARMY.maxUnits);
      }
      // A fixed field: every attempt that day is fought on the same ground.
      expect(legendSetup(l, l.seed!, 0.5).map).toEqual(legendSetup(l, l.seed!, 0.5).map);
    }
  });

  it('is found by its id, and only for a real day', async () => {
    const { legendById } = await import('../src/app/legends');
    expect(legendById('daily:2026-09-23')?.id).toBe('daily:2026-09-23');
    expect(legendById('daily:tomorrow')).toBeUndefined();
    expect(legendById('bellCharge')?.title).toBe('The Bell Charge');
  });

  it('counts the days won in a row, across months and years', async () => {
    const { dailyStreak, dayBefore } = await import('../src/app/daily');
    expect(dayBefore('2026-03-01')).toBe('2026-02-28');
    expect(dayBefore('2026-01-01')).toBe('2025-12-31');
    const won = { '2025-12-30': 'gold', '2025-12-31': 'bronze', '2026-01-01': 'silver' };
    expect(dailyStreak(won, '2026-01-01')).toBe(3);
    // Today not yet fought: the run up to yesterday still stands.
    expect(dailyStreak(won, '2026-01-02')).toBe(3);
    // A day missed ends it.
    expect(dailyStreak(won, '2026-01-03')).toBe(0);
    expect(dailyStreak(undefined, '2026-01-01')).toBe(0);
  });

  it('keeps its medals apart from the Legends', async () => {
    const { book, bestMedal, forgetBook, noteLegend } = await import('../src/app/book');
    forgetBook();
    expect(noteLegend('daily:2026-09-23', 'silver')).toBe(true);
    expect(noteLegend('daily:2026-09-23', 'bronze')).toBe(false);
    expect(book.value.daily?.['2026-09-23']).toBe('silver');
    expect(Object.keys(book.value.legends ?? {})).toEqual([]);
    expect(bestMedal('daily:2026-09-23')).toBe('silver');
    expect(noteLegend('daily:2026-09-23', 'gold')).toBe(true);
    expect(bestMedal('daily:2026-09-23')).toBe('gold');
    forgetBook();
  });
});
