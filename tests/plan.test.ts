/**
 * A general's plan in the battle setup steers the scripted AI, and a planned
 * battle replays exactly.
 */
import { describe, expect, it } from 'vitest';
import { Battle } from '../src/sim/battle';
import { BattleAI } from '../src/ai/battleAI';
import { aiOptions } from '../src/ai/plan';
import type { ArmyPlan, BattleSetup } from '../src/sim/types';
import { fingerprint, makeSetup, stepSeconds } from './helpers';

function setup(plan?: ArmyPlan): BattleSetup {
  const s = makeSetup({
    seed: 4,
    armies: [
      { faction: 'vesperate', controller: 'ai', units: ['vesperate.hourLevy', 'vesperate.hourLevy', 'vesperate.vesperArbalests'] },
      { faction: 'drift', controller: 'ai', units: ['drift.reedspears', 'drift.galeDancers', 'drift.galeDancers'] },
    ],
  });
  if (plan) s.armies[1].plan = plan;
  return s;
}

function run(s: BattleSetup, seconds: number): Battle {
  const b = new Battle(s);
  for (const side of [0, 1] as const) b.setController(side, new BattleAI(aiOptions(s.armies[side])));
  stepSeconds(b, seconds);
  return b;
}

/** How far side 1's army has come from where it started. */
function advance(b: Battle, start: Map<number, number>): number {
  const mine = b.units.filter((u) => u.side === 1);
  return mine.reduce((a, u) => a + Math.abs(u.y - start.get(u.id)!), 0) / mine.length;
}

describe('battle plans', () => {
  it('map to the scripted general’s options', () => {
    expect(aiOptions(setup().armies[1])).toEqual({});
    expect(aiOptions(setup({ stance: 'defend', patience: 120 }).armies[1])).toEqual({ plan: 'defend', patience: 120 });
    expect(aiOptions(setup({ stance: 'attack' }).armies[1])).toEqual({ plan: 'attack' });
  });

  it('a holding general keeps its ground; an attacking one comes on', () => {
    const starts = (s: BattleSetup) => new Map(new Battle(s).units.map((u) => [u.id, u.y]));
    const hold = setup({ stance: 'defend', patience: 300 });
    const attack = setup({ stance: 'attack' });
    const held = advance(run(hold, 25), starts(hold));
    const came = advance(run(attack, 25), starts(attack));
    expect(came).toBeGreaterThan(held + 40);
  });

  it('a planned battle replays exactly', () => {
    const s = setup({ stance: 'defend', patience: 60, speech: 'Hold.' });
    const a = run(JSON.parse(JSON.stringify(s)), 40);
    const b = run(JSON.parse(JSON.stringify(s)), 40);
    expect(fingerprint(a)).toEqual(fingerprint(b));
  });
});
