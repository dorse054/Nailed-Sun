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
