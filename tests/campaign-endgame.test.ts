import { describe, expect, it } from 'vitest';
import { newCampaign } from '../src/campaign/setup';
import { scriptedAI } from '../src/campaign/ai';
import { checkDeaths } from '../src/campaign/battles';
import { MOOT_RENOWN, checkVictory, gloamingSettlements } from '../src/campaign/victory';
import { CANDLES, KITE_FIELDS, NAIL_SPIRE, STOPPED_DIAL } from '../src/campaign/regions';
import { relation } from '../src/campaign/state';
import type { AiContext } from '../src/campaign/controller';
import type { CampaignState } from '../src/campaign/types';
import { FACTION_IDS, type FactionId } from '../src/data/schema';

const noBattles: AiContext = { battles: async () => [] };

/** Strip a faction to nothing but its lords: no towns, no men. */
function lordsOnly(s: CampaignState, f: FactionId): void {
  for (const r of Object.values(s.regions)) if (r.owner === f) r.owner = 'free';
  for (const a of s.armies) if (a.faction === f) a.units = [];
}

describe('a faction falls', () => {
  it('when it has no town and no army with men in it: a lone lord does not keep a realm alive', () => {
    const s = newCampaign({ faction: 'vesperate', seed: 3 });
    lordsOnly(s, 'hush');
    expect(s.armies.some((a) => a.faction === 'hush')).toBe(true);
    checkDeaths(s);
    expect(s.factions.hush.alive).toBe(false);
    // What was left of it leaves the map.
    expect(s.armies.some((a) => a.faction === 'hush')).toBe(false);
  });

  it('not while a landless host still has men to take a town back', () => {
    const s = newCampaign({ faction: 'vesperate', seed: 3 });
    for (const r of Object.values(s.regions)) if (r.owner === 'hush') r.owner = 'free';
    checkDeaths(s);
    expect(s.factions.hush.alive).toBe(true);
  });

  it('the Drift hold no land: they stand while a sail does, even an empty one, and fall with the last', () => {
    const s = newCampaign({ faction: 'vesperate', seed: 3 });
    for (const a of s.armies) if (a.faction === 'drift') a.units = [];
    checkDeaths(s);
    expect(s.factions.drift.alive).toBe(true);
    s.armies = s.armies.filter((a) => a.faction !== 'drift');
    checkDeaths(s);
    expect(s.factions.drift.alive).toBe(false);
  });

  it('so lordless remnants no longer block a Domination', () => {
    const s = newCampaign({ faction: 'vesperate', seed: 3 });
    for (const f of ['choir', 'hush'] as const) lordsOnly(s, f);
    s.armies = s.armies.filter((a) => a.faction !== 'drift');
    checkDeaths(s);
    checkVictory(s);
    expect(s.winner).toMatchObject({ faction: 'vesperate', kind: 'Domination' });
  });
});

describe('coalitions against a final victory stage', () => {
  /** The Vesperate hold every Gloaming town and the Dial at the Hour, in their final stage. */
  const vesperateFinal = (): CampaignState => {
    const s = newCampaign({ faction: 'drift', seed: 5 });
    s.turn = 60;
    s.tilt = 0;
    for (const g of [...gloamingSettlements(s), STOPPED_DIAL]) s.regions[g]!.owner = 'vesperate';
    const v = s.factions.vesperate;
    v.finalStage = true;
    v.hold = 1;
    // Everyone at peace lately, so no war of choice gets in the way.
    for (const a of FACTION_IDS) for (const b of FACTION_IDS) if (a < b) Object.assign(relation(s, a, b), { stance: 'peace', since: s.turn - 2 });
    // The Choir are the strongest of the Vesperate's rivals.
    s.factions.choir.coin = 60000;
    s.factions.hush.coin = 20000;
    return s;
  };
  const atWarWithVesperate = (s: CampaignState) => (['choir', 'hush', 'drift'] as const).filter((f) => relation(s, f, 'vesperate').stance === 'war');

  it('the strongest rival answers at once; the others join as the hold grows; the Drift stay out', async () => {
    const s = vesperateFinal();
    for (const f of ['choir', 'hush', 'drift'] as const) await scriptedAI(s, f, noBattles);
    expect(atWarWithVesperate(s)).toEqual(['choir']);
    s.factions.vesperate.hold = 5;
    for (const f of ['choir', 'hush', 'drift'] as const) await scriptedAI(s, f, noBattles);
    expect(atWarWithVesperate(s)).toEqual(['choir', 'hush']);
  });

  it('against the strongest power in the world, every neighbour able to fight marches at once', async () => {
    const s = vesperateFinal();
    // The Vesperate lead the world, but not so far that no one dares.
    s.factions.vesperate.coin = 60000;
    s.factions.choir.coin = 20000;
    for (const f of ['choir', 'hush', 'drift'] as const) await scriptedAI(s, f, noBattles);
    expect(atWarWithVesperate(s)).toEqual(['choir', 'hush']);
  });

  it('the settled powers let the Drift moot until it has stood a Toll', async () => {
    const s = newCampaign({ faction: 'vesperate', seed: 5 });
    s.turn = 60;
    s.factions.drift.res = MOOT_RENOWN;
    for (const a of FACTION_IDS) for (const b of FACTION_IDS) if (a < b) Object.assign(relation(s, a, b), { stance: 'peace', since: s.turn - 2 });
    s.factions.drift.finalStage = true;
    s.factions.drift.hold = 0;
    const atWarWithDrift = () => (['choir', 'hush', 'vesperate'] as const).filter((f) => relation(s, f, 'drift').stance === 'war');
    for (const f of ['choir', 'hush'] as const) await scriptedAI(s, f, noBattles);
    expect(atWarWithDrift()).toEqual([]);
    s.factions.drift.hold = 1;
    for (const f of ['choir', 'hush'] as const) await scriptedAI(s, f, noBattles);
    expect(atWarWithDrift().length).toBeGreaterThan(0);
  });

  it('nobody marches once the victory is out of reach', async () => {
    const s = vesperateFinal();
    s.regions[STOPPED_DIAL]!.owner = 'choir';
    for (const f of ['choir', 'hush', 'drift'] as const) await scriptedAI(s, f, noBattles);
    expect(atWarWithVesperate(s)).toEqual([]);
  });
});

describe('victory conditions', () => {
  it('the Choir stand in their final stage only while they could raise the next Lens stage; stages stay built', () => {
    const s = newCampaign({ faction: 'vesperate', seed: 5 });
    s.turn = 60;
    s.tilt = 3;
    s.regions[NAIL_SPIRE]!.owner = 'choir';
    for (const c of CANDLES) Object.assign(s.regions[c]!, { owner: 'choir', lit: true });
    s.factions.choir.lens = 2;
    checkVictory(s);
    expect(s.factions.choir.finalStage).toBe(true);
    // The Candles only begin the Lens: losing one later does not stop it.
    s.regions[CANDLES[0]!]!.owner = 'hush';
    checkVictory(s);
    expect(s.factions.choir.finalStage).toBe(true);
    s.regions[NAIL_SPIRE]!.owner = 'hush';
    checkVictory(s);
    expect(s.factions.choir.finalStage).toBe(false);
    expect(s.factions.choir.lens).toBe(2);
  });

  it('the Great Moot: enough Renown, and a sail holding the Kite Fields three straight Tolls', () => {
    const s = newCampaign({ faction: 'vesperate', seed: 5 });
    s.turn = 60;
    s.factions.drift.res = MOOT_RENOWN;
    expect(s.armies.some((a) => a.faction === 'drift' && a.region === KITE_FIELDS)).toBe(true);
    for (let i = 0; i < 2; i++) {
      checkVictory(s);
      s.turn++;
    }
    expect(s.winner).toBeUndefined();
    checkVictory(s);
    expect(s.winner).toMatchObject({ faction: 'drift', kind: 'The Great Moot' });
  });
});
