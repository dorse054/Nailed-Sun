/**
 * Heroes acting alone on the campaign map.
 */
import { describe, expect, it } from 'vitest';
import { newCampaign } from '../src/campaign/setup';
import type { CampaignState } from '../src/campaign/types';
import { allUnits } from '../src/data/index';
import { neighbors, stepsFrom } from '../src/campaign/geometry';
import { relation } from '../src/campaign/state';
import { detachHero, heroAct, heroActions, heroById, heroes, heroesNewToll, heroReach, heroVision, joinArmy, moveHero, RALLY_ORDER, SABOTAGE_GARRISON } from '../src/campaign/heroes';

const HERO = allUnits().find((u) => u.faction === 'vesperate' && u.character?.kind === 'hero')!.id;

/** A Vesperate campaign whose first army carries a hero, sent out alone. */
function withHero(seed = 3): { s: CampaignState; id: string; home: string } {
  const s = newCampaign({ faction: 'vesperate', seed });
  const a = s.armies.find((x) => x.faction === 'vesperate')!;
  a.units.push({ def: HERO, strength: 1, rank: 0, xp: 0 });
  const r = detachHero(s, a.id, a.units.length - 1);
  expect(r.ok).toBe(true);
  return { s, id: heroes(s)[0]!.id, home: a.region };
}

describe('lone heroes', () => {
  it('leave their army and wait a Toll before travelling', () => {
    const { s, id, home } = withHero();
    const h = heroById(s, id)!;
    expect(h.region).toBe(home);
    expect(s.armies.some((a) => a.units.some((u) => u.def === HERO))).toBe(false);
    expect(moveHero(s, id, neighbors(home)[0]!).ok).toBe(false);
    heroesNewToll(s);
    expect(Object.values(heroReach(s, h)).every((d) => d >= 1 && d <= 2)).toBe(true);
  });

  it('travel up to two regions a Toll, past anything in the way', () => {
    const { s, id, home } = withHero();
    heroesNewToll(s);
    const far = Object.entries(stepsFrom(home)).find(([, d]) => d === 3)![0];
    expect(moveHero(s, id, far).ok).toBe(false);
    const two = Object.entries(stepsFrom(home)).find(([, d]) => d === 2)![0];
    expect(moveHero(s, id, two).ok).toBe(true);
    expect(heroById(s, id)!.moves).toBe(0);
    expect(moveHero(s, id, home).ok).toBe(false);
  });

  it('rally a friendly town, once a Toll', () => {
    const { s, id, home } = withHero();
    heroesNewToll(s);
    const r = s.regions[home]!;
    r.order = 0;
    expect(heroAct(s, id, 'rally').ok).toBe(true);
    expect(r.order).toBe(RALLY_ORDER);
    expect(heroAct(s, id, 'rally').ok).toBe(false);
  });

  it('sabotage an enemy town at war: a weaker garrison, or a wounded hero', () => {
    const { s, id } = withHero();
    heroesNewToll(s);
    const h = heroById(s, id)!;
    // Put the hero in a town of a faction the Vesperate are at war with.
    const target = Object.keys(s.regions).find((k) => {
      const o = s.regions[k]!.owner;
      return o !== 'free' && o !== 'vesperate';
    })!;
    const owner = s.regions[target]!.owner as Exclude<typeof s.regions[string]['owner'], 'free'>;
    relation(s, 'vesperate', owner).stance = 'war';
    h.region = target;
    s.regions[target]!.garrisonLoss = 0;
    expect(heroActions(s, h).find((a) => a.kind === 'sabotage')?.why).toBeUndefined();
    expect(heroAct(s, id, 'sabotage').ok).toBe(true);
    const weakened = (s.regions[target]!.garrisonLoss ?? 0) >= SABOTAGE_GARRISON;
    const wounded = (h.restUntil ?? 0) > s.turn;
    expect(weakened !== wounded).toBe(true);
  });

  it('cannot sabotage a faction at peace', () => {
    const { s, id } = withHero();
    const h = heroById(s, id)!;
    const target = Object.keys(s.regions).find((k) => {
      const o = s.regions[k]!.owner;
      return o !== 'free' && o !== 'vesperate';
    })!;
    const owner = s.regions[target]!.owner as Exclude<typeof s.regions[string]['owner'], 'free'>;
    relation(s, 'vesperate', owner).stance = 'peace';
    h.region = target;
    heroesNewToll(s);
    expect(heroActions(s, h).find((a) => a.kind === 'sabotage')?.why).toBeTruthy();
  });

  it('see around them, farther while scouting', () => {
    const { s, id, home } = withHero();
    heroesNewToll(s);
    const near = heroVision(s, 'vesperate');
    for (const n of neighbors(home)) expect(near.has(n)).toBe(true);
    expect(heroAct(s, id, 'scout').ok).toBe(true);
    const far = heroVision(s, 'vesperate');
    expect(far.size).toBeGreaterThan(near.size);
  });

  it('rejoin a friendly army in the same region, and survive a save', () => {
    const { s, id } = withHero();
    const copy = JSON.parse(JSON.stringify(s)) as CampaignState;
    expect(heroes(copy).length).toBe(1);
    const a = s.armies.find((x) => x.faction === 'vesperate')!;
    expect(joinArmy(s, id, a.id).ok).toBe(true);
    expect(heroes(s).length).toBe(0);
    expect(a.units.some((u) => u.def === HERO)).toBe(true);
  });
});
