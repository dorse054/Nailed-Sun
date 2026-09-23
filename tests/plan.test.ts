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

  it('a change of plan mid-battle turns a holding army to the attack, speaks, and is logged', () => {
    const s = setup({ stance: 'defend', patience: 600 });
    const starts = new Map(new Battle(s).units.map((u) => [u.id, u.y]));
    const b = new Battle(JSON.parse(JSON.stringify(s)), { events: true });
    for (const side of [0, 1] as const) b.setController(side, new BattleAI(aiOptions(b.setup.armies[side])));
    stepSeconds(b, 10);
    b.takeEvents();
    const before = advance(b, starts);
    b.issue(1, { type: 'plan', stance: 'attack', speech: 'Now!' });
    b.step();
    expect(b.sides[1].plan).toMatchObject({ stance: 'attack' });
    expect(b.takeEvents().some((e) => e.t === 'plan' && e.side === 1 && e.speech === 'Now!')).toBe(true);
    expect(b.log.some((c) => c.side === 1 && c.cmd.type === 'plan')).toBe(true);
    stepSeconds(b, 20);
    expect(advance(b, starts)).toBeGreaterThan(before + 40);
  });

  it('a battle with a change of plan replays exactly from its log', () => {
    const s = setup({ stance: 'defend', patience: 600 });
    const live = new Battle(JSON.parse(JSON.stringify(s)));
    for (const side of [0, 1] as const) live.setController(side, new BattleAI(aiOptions(live.setup.armies[side])));
    stepSeconds(live, 12);
    live.issue(1, { type: 'plan', stance: 'attack', speech: 'Now!' });
    stepSeconds(live, 30);
    live.issue(1, { type: 'plan', stance: 'defend', patience: 90 });
    stepSeconds(live, 20);
    const again = new Battle(JSON.parse(JSON.stringify(s)), { replay: live.log });
    for (const side of [0, 1] as const) again.setController(side, new BattleAI(aiOptions(again.setup.armies[side])));
    stepSeconds(again, live.time);
    expect(fingerprint(again)).toEqual(fingerprint(live));
    expect(again.sides[1].plan).toMatchObject({ stance: 'defend', patience: 90 });
  });

  it('a planned battle replays exactly', () => {
    const s = setup({ stance: 'defend', patience: 60, speech: 'Hold.' });
    const a = run(JSON.parse(JSON.stringify(s)), 40);
    const b = run(JSON.parse(JSON.stringify(s)), 40);
    expect(fingerprint(a)).toEqual(fingerprint(b));
  });
});
