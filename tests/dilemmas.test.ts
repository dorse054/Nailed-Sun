/**
 * Dilemmas: choices the world puts to the player now and then.
 */
import { describe, expect, it } from 'vitest';
import { newCampaign } from '../src/campaign/setup';
import type { CampaignState } from '../src/campaign/types';
import { maybeDilemma, pendingDilemma, resolveDilemma } from '../src/campaign/dilemmas';

/** Toll by Toll until a dilemma comes (or give up). */
function untilDilemma(s: CampaignState, maxTurn = 40): boolean {
  for (; s.turn <= maxTurn; s.turn++) if (maybeDilemma(s)) return true;
  return false;
}

describe('dilemmas', () => {
  it('none in the first Tolls, then one comes, with two priced choices', () => {
    const s = newCampaign({ faction: 'vesperate', seed: 3 });
    for (s.turn = 1; s.turn < 4; s.turn++) expect(maybeDilemma(s)).toBe(false);
    expect(untilDilemma(s)).toBe(true);
    const d = pendingDilemma(s)!;
    expect(d.title.length).toBeGreaterThan(0);
    expect(d.text).not.toMatch(/undefined/);
    expect(d.choices).toHaveLength(2);
    // Only one at a time.
    expect(maybeDilemma(s)).toBe(false);
  });

  it('come the same way in the same campaign', () => {
    const a = newCampaign({ faction: 'hush', seed: 11 });
    const b = newCampaign({ faction: 'hush', seed: 11 });
    untilDilemma(a);
    untilDilemma(b);
    expect(a.dilemma).toEqual(b.dilemma);
  });

  it('apply the chosen price, tell the chronicle, and are not repeated soon', () => {
    const s = newCampaign({ faction: 'choir', seed: 5 });
    untilDilemma(s);
    const id = s.dilemma!.id;
    const before = { coin: s.factions.choir.coin, events: s.events.length };
    const choice = pendingDilemma(s)!.choices[0];
    expect(resolveDilemma(s, 0)).toBe(true);
    if (choice.effect.coin) expect(s.factions.choir.coin).toBe(before.coin + choice.effect.coin);
    expect(s.events.length).toBe(before.events + 1);
    expect(s.dilemma).toBeUndefined();
    expect(s.dilemmasSeen).toContain(id);
    // A few Tolls must pass before the next, and it is a different one.
    expect(maybeDilemma(s)).toBe(false);
    s.turn += 1;
    untilDilemma(s, s.turn + 30);
    expect(s.dilemma?.id).not.toBe(id);
  });

  it('keep order within its bounds', () => {
    const s = newCampaign({ faction: 'vesperate', seed: 9 });
    for (const r of Object.values(s.regions)) if (r.owner === 'vesperate') r.order = 20;
    s.dilemma = { id: 'festival', region: 'vesper', turn: s.turn };
    resolveDilemma(s, 0);
    expect(s.regions.vesper!.order).toBe(20);
  });
});

describe('written dilemmas', () => {
  it('price each choice from the menu, and refuse unfair or unknown pairs', async () => {
    const { newCampaign } = await import('../src/campaign/setup');
    const { writtenEffect, pendingDilemma, resolveDilemma } = await import('../src/campaign/dilemmas');
    const s = newCampaign({ faction: 'vesperate', difficulty: 'normal', seed: 5 });
    expect(writtenEffect(s, 'coin', 'order')).toEqual({ coin: 120, order: -3 });
    expect(writtenEffect(s, 'friendship', 'food', 'drift')).toEqual({ opinion: { of: 'drift', by: 10 }, food: -20 });
    expect(writtenEffect(s, 'sunward', 'enmity', undefined, 'choir')).toEqual({ tilt: 5, opinion: { of: 'choir', by: -10 } });
    // Same kind both ways, the player's own faction, a made-up boon: no.
    expect(writtenEffect(s, 'coin', 'coin')).toBeNull();
    expect(writtenEffect(s, 'friendship', 'enmity', 'drift', 'choir')).toBeNull();
    expect(writtenEffect(s, 'friendship', 'coin', 'vesperate')).toBeNull();
    expect(writtenEffect(s, 'gold', 'coin')).toBeNull();
    // A written dilemma is what the player sees and chooses from.
    const region = Object.keys(s.regions).find((r) => s.regions[r]!.owner === 'vesperate')!;
    const coin = s.factions.vesperate.coin;
    s.dilemma = { id: 'pilgrims', region, turn: s.turn, written: { title: 'A Test', text: 'Something happens here.', choices: [{ label: 'Take it', effect: { coin: 120, order: -3 } }, { label: 'Leave it', effect: { food: 30, coin: -100 } }] } };
    expect(pendingDilemma(s)).toMatchObject({ title: 'A Test', written: true });
    expect(resolveDilemma(s, 0)).toBe(true);
    expect(s.factions.vesperate.coin).toBe(coin + 120);
    expect(s.dilemmasSeen ?? []).not.toContain('pilgrims');
  });
});
