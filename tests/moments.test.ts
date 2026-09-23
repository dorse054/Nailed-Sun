/**
 * The battle's turning points are noted as they happen, and the book keeps
 * records, tales and medals the way the Chronicles screen expects.
 */
import { describe, expect, it } from 'vitest';
import { Battle } from '../src/sim/battle';
import { BattleAI } from '../src/ai/battleAI';
import { MomentLog, clock } from '../src/app/battle/moments';
import { addTale, book, forgetBook, noteBattle, noteCampaign, noteLegend } from '../src/app/book';
import { makeSetup } from './helpers';

describe('turning points', () => {
  it('note the lines meeting, routs and what fell, in order, and stop at a limit', () => {
    const s = makeSetup({
      seed: 11,
      armies: [
        { faction: 'vesperate', controller: 'ai', units: ['vesperate.maren', 'vesperate.hourLevy', 'vesperate.hourLevy', 'vesperate.lanternGuard', 'vesperate.antleredLancers'] },
        { faction: 'drift', controller: 'ai', units: ['drift.taviLongwind', 'drift.reedspears', 'drift.galeDancers', 'drift.dustrunners', 'drift.windbows'] },
      ],
    });
    const b = new Battle(s, { events: true });
    b.setController(0, new BattleAI({ stance: 'attack' }));
    b.setController(1, new BattleAI({ stance: 'attack' }));
    const log = new MomentLog(b);
    while (!b.result && b.tick < 20 * 600) {
      b.step();
      log.consume(b.takeEvents());
    }
    const texts = log.list.map((m) => m.text);
    expect(texts.filter((t) => t === 'The lines met.').length).toBe(1);
    expect(texts.some((t) => /broke and ran|was brought down|left the field/.test(t))).toBe(true);
    for (let i = 1; i < log.list.length; i++) expect(log.list[i]!.t).toBeGreaterThanOrEqual(log.list[i - 1]!.t);
    expect(log.list.length).toBeLessThanOrEqual(30);
    // Nothing is told twice about one unit's end.
    const gone = texts.filter((t) => /was brought down|left the field/.test(t));
    expect(new Set(gone.map((t) => t.replace(/ (was brought down|left the field)\.$/, ''))).size).toBe(gone.length);
    expect(clock(125)).toBe('2:05');
  });
});

describe('the book', () => {
  it('counts battles, campaigns once, keeps the best medal and one copy of a tale', () => {
    forgetBook();
    noteBattle('hush', true);
    noteBattle('hush', false);
    expect(book.value.records.hush).toMatchObject({ fought: 2, won: 1 });
    noteCampaign('1:hush:normal', 'hush', true, 80);
    noteCampaign('1:hush:normal', 'hush', true, 80);
    noteCampaign('2:hush:normal', 'hush', true, 64);
    expect(book.value.records.hush).toMatchObject({ campaigns: 2, campaignsWon: 2, fastest: 64 });
    expect(noteLegend('bellCharge', 'silver')).toBe(true);
    expect(noteLegend('bellCharge', 'bronze')).toBe(false);
    expect(noteLegend('bellCharge', 'gold')).toBe(true);
    expect(book.value.legends?.bellCharge).toBe('gold');
    const tale = { kind: 'battle' as const, title: 'The Ford', text: 'They came at dusk.', faction: 'hush' as const, won: true };
    addTale(tale);
    addTale(tale);
    expect(book.value.tales.length).toBe(1);
    forgetBook();
    expect(book.value.tales.length).toBe(0);
    expect(book.value.records.hush.fought).toBe(0);
  });
});

describe('feats', () => {
  it('are earned once, from what a won battle shows', async () => {
    const { battleFeats, legendFeats } = await import('../src/app/feats');
    const { noteLegend } = await import('../src/app/book');
    forgetBook();
    const unit = (def: string, state: string) => ({ id: 0, def, name: def, start: 10, alive: 10, kills: 0, damageDealt: 0, valueDealt: 0, state, cost: 100, hp: 1 });
    const setup = { seed: 1, map: { seed: 1, band: 'gloaming', wind: 1, sunBearing: 0, fort: { defender: 0, radius: 170 } }, armies: [] } as never;
    const result = {
      winner: 0,
      reason: 'timeout',
      time: 600,
      sides: [
        { faction: 'hush', soldiersStart: 100, soldiersLost: 5, costStart: 5000, costLost: 500, units: [unit('hush.theUnlit', 'ready')] },
        { faction: 'choir', soldiersStart: 100, soldiersLost: 90, costStart: 9000, costLost: 8000, units: [unit('choir.nailbearer', 'dead')] },
      ],
    } as never;
    const ids = battleFeats(setup, result, 0).map((f) => f.id);
    expect(ids).toEqual(expect.arrayContaining(['firstBlood', 'flawless', 'heroic', 'odds', 'giantSlayer', 'hold']));
    expect(ids).not.toContain('storm');
    expect(battleFeats(setup, result, 0)).toEqual([]);
    for (const id of ['bellCharge', 'silentCharge', 'downwindRun', 'colossusDuel', 'lightWars', 'mirrorTrap']) noteLegend(id, 'gold');
    expect(legendFeats().map((f) => f.id)).toEqual(['legendary', 'golden']);
    forgetBook();
  });
});
