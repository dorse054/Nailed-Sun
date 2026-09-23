import { describe, expect, it } from 'vitest';
import { CONDITIONS, parseConditions, sunFor } from '../src/balance/conditions';
import { colossusVsArms, combinedArms, costMatch, duelUnits, factionMatchups, unitDuels } from '../src/balance/suites';
import { costFormulaTable } from '../src/balance/formula';
import { runJob } from '../src/balance/runner';
import type { JobResult } from '../src/balance/runner';
import { buildReport, reportMarkdown } from '../src/balance/report';
import { rate } from '../src/balance/stats';
import { Rng } from '../src/core/rng';
import { armyCost } from '../src/game/armyGen';
import { FACTIONS } from '../src/data/index';

describe('conditions', () => {
  it('has the 15 light and wind combinations', () => {
    expect(CONDITIONS).toHaveLength(15);
    expect(new Set(CONDITIONS.map((c) => c.key)).size).toBe(15);
    for (const c of CONDITIONS) expect(c.index).toBe(c.light * 3 + c.wind);
    expect(CONDITIONS[7]!.label).toBe('Dusk / Breeze');
  });
  it('parses filters', () => {
    expect(parseConditions('all')).toHaveLength(15);
    expect(parseConditions('dusk-breeze,0').map((c) => c.index)).toEqual([7, 0]);
    expect(parseConditions('light=dark,blaze;wind=gale').map((c) => c.key)).toEqual(['dark-gale', 'blaze-gale']);
    expect(() => parseConditions('noon')).toThrow();
  });
  it('turns the sun through all four bearings', () => {
    expect([0, 1, 2, 3].map((i) => sunFor(i).key)).toEqual(['N', 'E', 'S', 'W']);
  });
});

describe('suites', () => {
  it('matches costs within 10% with few copies', () => {
    expect(costMatch(800, 800)).toEqual([1, 1]);
    const [a, b] = costMatch(1800, 400);
    expect(Math.abs((a * 1800) / (b * 400) - 1)).toBeLessThanOrEqual(0.1 + 1e-9);
    for (const [x, y] of [
      [450, 1300],
      [550, 750],
      [900, 1250],
    ] as const) {
      const [na, nb] = costMatch(x, y);
      expect(Math.abs((na * x) / (nb * y) - 1)).toBeLessThanOrEqual(0.1 + 1e-9);
    }
  });

  it('fights every faction fixture twice with the sides swapped', () => {
    const jobs = factionMatchups({ seeds: 1, conditions: parseConditions('dusk-breeze') });
    expect(jobs).toHaveLength(12);
    const byFixture = new Map<string, typeof jobs>();
    for (const j of jobs) byFixture.set(j.tags.fixture, [...(byFixture.get(j.tags.fixture) ?? []), j]);
    for (const [, pair] of byFixture) {
      expect(pair).toHaveLength(2);
      const [x, y] = pair as [(typeof jobs)[0], (typeof jobs)[0]];
      expect(x.setup.armies[0]).toEqual(y.setup.armies[1]);
      expect(x.setup.armies[1]).toEqual(y.setup.armies[0]);
      expect(x.setup.map).toEqual(y.setup.map);
    }
  });

  it('duels every regular unit against every enemy-faction unit', () => {
    const units = duelUnits('choir');
    expect(units.every((u) => !u.character && u.category !== 'colossus')).toBe(true);
    const jobs = unitDuels({ factions: ['choir', 'hush'] });
    expect(jobs).toHaveLength(duelUnits('choir').length * duelUnits('hush').length * 2);
    for (const j of jobs) {
      const [c0, c1] = j.tags.costs;
      expect(Math.abs(c0 / c1 - 1)).toBeLessThanOrEqual(0.12);
    }
  });

  it('gives each colossus an equal-cost combined-arms force without characters', () => {
    const arms = combinedArms('vesperate', 3200, new Rng('t'));
    const cost = armyCost(arms);
    expect(cost).toBeLessThanOrEqual(3200);
    expect(cost).toBeGreaterThan(2800);
    const f = FACTIONS.vesperate;
    expect(arms.some((s) => s.def === f.lord.id || s.def === f.colossus.id || f.heroes.some((h) => h.id === s.def))).toBe(false);
    expect(colossusVsArms({ factions: ['choir', 'hush'], conditions: parseConditions('dusk-breeze') })).toHaveLength(4);
  });
});

describe('cost formula', () => {
  it('gives a finite, positive price for every unit', () => {
    for (const r of costFormulaTable()) {
      expect(Number.isFinite(r.formula)).toBe(true);
      expect(r.formula).toBeGreaterThan(0);
      expect(r.ehp).toBeGreaterThan(0);
    }
  });
});

describe('runner', () => {
  it('is deterministic', () => {
    const job = unitDuels({ factions: ['hush', 'drift'], units: ['hush.rimeHounds'] }).find((j) => j.tags.subjects[1] === 'drift.galeDancers')!;
    const a = runJob(job);
    const b = runJob(job);
    expect(a.error).toBeUndefined();
    expect({ ...a, cpuMs: 0 }).toEqual({ ...b, cpuMs: 0 });
    expect(a.time).toBeGreaterThan(0);
  });
});

describe('report', () => {
  it('flags a lopsided matchup and renders markdown', () => {
    const jobs = factionMatchups({ factions: ['choir', 'hush'], seeds: 4, conditions: parseConditions('dusk-breeze') });
    // Synthetic results: Choir wins every battle.
    const results: JobResult[] = jobs.map((j) => ({
      id: j.id,
      suite: j.suite,
      tags: j.tags,
      winner: j.tags.factions[0] === 'choir' ? 0 : 1,
      reason: 'rout',
      time: 100,
      cpuMs: 1,
      sides: [0, 1].map((s) => ({ faction: j.tags.factions[s]!, cost: 12000, killed: 0.5, removed: 0.5, lost: 0.5, soldiers: 100, soldiersLost: 50 })) as JobResult['sides'],
    }));
    const r = buildReport(results, { generated: 'test', settings: {} });
    expect(r.factions!.matrix.choir!.hush!.rate).toBe(1);
    expect(r.targets[0]!.status).toBe('fail');
    expect(r.targets[2]!.status).toBe('not run');
    expect(r.flags.some((f) => f.target === 1 && f.severity === 'fail')).toBe(true);
    const md = reportMarkdown(r);
    expect(md).toContain('## Targets');
    expect(md).toContain('| **Choir** |');
  });

  it('computes Wilson intervals', () => {
    const r = rate(5, 10);
    expect(r.rate).toBe(0.5);
    expect(r.lo).toBeGreaterThan(0.2);
    expect(r.hi).toBeLessThan(0.8);
    expect(rate(0, 0).n).toBe(0);
  });
});
