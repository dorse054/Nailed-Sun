import { describe, expect, it } from 'vitest';
import { newCampaign } from '../src/campaign/setup';
import { REGIONS, CANDLES, VALES } from '../src/campaign/regions';
import { SHAPES, stepsFrom } from '../src/campaign/geometry';
import { armyUpkeep, bandIndex, findPath, reachable, regionYield, stepCost } from '../src/campaign/rules';
import { build, buildOptions, moveArmy, recruit, recruitOptions } from '../src/campaign/actions';
import { victoryStatus, VICTORY_OPENS, checkVictory } from '../src/campaign/victory';
import { prepareBattle, sunBearing, sunForAttacker, garrisonFor } from '../src/campaign/battles';
import { endRound, stepTilt } from '../src/campaign/turn';
import { valueDeal } from '../src/campaign/diplomacy';
import { relation } from '../src/campaign/state';
import { unitDef } from '../src/data/index';
import type { CampaignState } from '../src/campaign/types';

const fresh = (seed = 5): CampaignState => newCampaign({ faction: 'vesperate', seed });

describe('campaign map', () => {
  it('has about thirty regions, each with a shape and symmetric adjacency', () => {
    expect(REGIONS.length).toBeGreaterThanOrEqual(30);
    for (const r of REGIONS) {
      const sh = SHAPES[r.id]!;
      expect(sh.poly.length).toBeGreaterThan(6);
      expect(sh.neighbors.length).toBeGreaterThanOrEqual(2);
      for (const n of sh.neighbors) expect(SHAPES[n]!.neighbors).toContain(r.id);
    }
  });

  it('is one connected world', () => {
    const d = stepsFrom(REGIONS[0]!.id);
    expect(Object.keys(d).length).toBe(REGIONS.length);
  });

  it('has three Candles, the Umbral Vales and a Gale Road in every band', () => {
    expect(CANDLES).toHaveLength(3);
    expect(VALES.length).toBeGreaterThanOrEqual(2);
    const s = fresh();
    const roadBands = new Set(REGIONS.filter((r) => r.galeRoad).map((r) => bandIndex(s, r.id)));
    expect(roadBands.size).toBe(5);
  });
});

describe('the Tilt', () => {
  it('moves border regions first and every region one band at ±5', () => {
    const s = fresh();
    const base = Object.fromEntries(REGIONS.map((r) => [r.id, bandIndex(s, r.id)]));
    s.tilt = 1;
    const flipped = REGIONS.filter((r) => bandIndex(s, r.id) !== base[r.id]);
    expect(flipped.length).toBeGreaterThan(0);
    expect(flipped.length).toBeLessThan(REGIONS.length / 2);
    s.tilt = 5;
    for (const r of REGIONS) expect(bandIndex(s, r.id)).toBe(Math.min(4, base[r.id]! + 1));
  });

  it('steps when the pressure reaches 100 and stops at the ends', () => {
    const s = fresh();
    s.tiltProgress = 250;
    stepTilt(s);
    expect(s.tilt).toBe(2);
    expect(s.tiltProgress).toBe(50);
    s.tilt = 5;
    s.tiltProgress = 180;
    stepTilt(s);
    expect(s.tilt).toBe(5);
  });
});

describe('economy', () => {
  it('pays the Vesperate from their cities, and the Drift have none', () => {
    const s = fresh();
    const coin = REGIONS.filter((r) => s.regions[r.id]!.owner === 'vesperate').reduce((t, r) => t + regionYield(s, r.id).coin, 0);
    expect(coin).toBeGreaterThan(300);
    expect(REGIONS.some((r) => s.regions[r.id]!.owner === 'drift')).toBe(false);
  });

  it('charges 5% more upkeep for every duplicate copy of a unit', () => {
    const s = fresh();
    const a = s.armies.find((x) => x.faction === 'vesperate')!;
    a.units = [{ def: 'vesperate.lanternGuard', strength: 1, rank: 0, xp: 0 }];
    const one = armyUpkeep(a);
    a.units.push({ def: 'vesperate.lanternGuard', strength: 1, rank: 0, xp: 0 });
    const two = armyUpkeep(a);
    const lord = unitDef(a.lord.def).cost * 0.05;
    // Upkeep is rounded to whole coins.
    expect(Math.abs(two - lord - (one - lord) * 2 * 1.05)).toBeLessThanOrEqual(1.5);
  });
});

describe('actions', () => {
  it('recruits only what the settlement can train, and spends coin', () => {
    const s = fresh();
    const a = s.armies.find((x) => x.faction === 'vesperate')!;
    const opts = recruitOptions(s, a.id);
    const levy = opts.find((o) => o.def.id === 'vesperate.hourLevy')!;
    expect(levy.ok).toBe(true);
    const cannon = opts.find((o) => o.def.id === 'vesperate.knellCannon')!;
    expect(cannon.ok).toBe(false);
    const before = s.factions.vesperate.coin;
    expect(recruit(s, a.id, levy.def.id).ok).toBe(true);
    expect(s.factions.vesperate.coin).toBe(before - levy.coin);
  });

  it('builds one thing per settlement per Toll, finished next Toll', () => {
    const s = fresh();
    const town = 'amberfields';
    const empty = s.regions[town]!.slots.findIndex((x) => !x);
    expect(empty).toBeGreaterThanOrEqual(0);
    expect(buildOptions(s, town, 99)).toHaveLength(0);
    const opt = buildOptions(s, town, empty).find((o) => o.ok)!;
    expect(build(s, town, empty, opt.chain.id).ok).toBe(true);
    const other = s.regions[town]!.slots.findIndex((x) => !x);
    if (other >= 0) expect(buildOptions(s, town, other).every((o) => !o.ok)).toBe(true);
    endRound(s);
    expect(s.regions[town]!.slots[empty]!.level).toBe(1);
  });

  it('marches two steps a Toll and stops at a hostile settlement', () => {
    const s = fresh();
    const a = s.armies.find((x) => x.faction === 'vesperate')!;
    const reach = reachable(s, a);
    expect(Object.keys(reach).length).toBeGreaterThan(2);
    const free = Object.keys(reach).find((id) => s.regions[id]!.owner === 'free' && REGIONS.find((r) => r.id === id)!.settlement)!;
    const r = moveArmy(s, a.id, free);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.atSettlement).toBe(free);
    expect(a.moves).toBe(0);
  });

  it('lets the Drift sail faster sunward than nightward', () => {
    const s = fresh();
    const d = s.armies.find((x) => x.faction === 'drift')!;
    const south = stepCost(s, d, 'kiteFields', 'saltroad');
    const north = stepCost(s, d, 'kiteFields', 'mothbarrens');
    expect(south).toBeLessThanOrEqual(north);
    expect(findPath(s, d, 'saltroad')).not.toBeNull();
    // Marches stop at hostile settlements: nothing beyond them is on a route.
    expect(findPath(s, d, 'scour')).toBeNull();
  });
});

describe('battles', () => {
  it('puts the sun at the back of an army marching north and in the eyes of one marching south', () => {
    expect(sunForAttacker('aumsgate', 'vesper')).toBe('back');
    expect(sunForAttacker('vesper', 'aumsgate')).toBe('eyes');
    // Side 0 faces up the screen: marching north puts the sun behind it (down the screen).
    expect(Math.sin(sunBearing('aumsgate', 'vesper', 0))).toBeGreaterThan(0.5);
  });

  it('builds a fortified assault with a garrison from the free city culture', () => {
    const s = fresh();
    const a = s.armies.find((x) => x.faction === 'hush')!;
    const pb = { id: 'b1', attacker: { faction: 'hush' as const, armies: [a.id] }, defender: { faction: 'free' as const, armies: [], garrison: true }, region: 'candleVigil', from: 'pole', assault: true };
    const prep = prepareBattle(s, pb, { auto: true, unitScale: 0.35 });
    expect(prep.setup.map.fort).toBeTruthy();
    expect(prep.setup.armies[1].units.length).toBe(garrisonFor(s, 'candleVigil').length);
    expect(prep.setup.map.band).toBe('evernight');
  });
});

describe('victory', () => {
  it('keeps final stages closed until the late game', () => {
    const s = fresh();
    s.turn = VICTORY_OPENS - 1;
    for (const r of REGIONS) if (bandIndex(s, r.id) === 2 && r.settlement) s.regions[r.id]!.owner = 'vesperate';
    s.factions.vesperate.hold = 20;
    expect(victoryStatus(s, 'vesperate').met).toBe(false);
    checkVictory(s);
    expect(s.winner).toBeUndefined();
  });
});

describe('diplomacy and saves', () => {
  it('values peace higher for the side that is losing', () => {
    const s = fresh();
    relation(s, 'choir', 'hush').opinion = 0;
    s.armies = s.armies.filter((a) => a.faction !== 'hush');
    const v = valueDeal(s, { kind: 'peace', from: 'choir', to: 'hush' });
    const w = valueDeal(s, { kind: 'peace', from: 'hush', to: 'choir' });
    expect(v.value).toBeGreaterThan(w.value);
  });

  it('survives a JSON round trip and plays on identically', () => {
    const a = fresh(9);
    const b = JSON.parse(JSON.stringify(a)) as CampaignState;
    endRound(a);
    endRound(b);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });
});
