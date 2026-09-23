import { afterEach, describe, expect, it, vi } from 'vitest';
import { newCampaign } from '../src/campaign/setup';
import { aiExplain, scriptedAI } from '../src/campaign/ai';
import { JEV_TIMEOUT_MS, JEV_WAR_FROM, consultJev, optionsFor, prefetchJev, setJevProvider, situationFor, type JevProvider } from '../src/campaign/jev';
import { offerToPlayer, refreshBattle, type AiContext, type TurnHooks } from '../src/campaign/controller';
import { applyBattle, attackerPower, defenderPower, prepareBattle } from '../src/campaign/battles';
import { relation } from '../src/campaign/state';
import { endRound } from '../src/campaign/turn';
import type { Deal } from '../src/campaign/diplomacy';
import type { CampaignState } from '../src/campaign/types';
import type { BattleResult, SideSummary } from '../src/sim/types';
import { FACTION_IDS } from '../src/data/schema';
import { recruitOptions, recruitSite } from '../src/campaign/actions';
import { neighbors } from '../src/campaign/geometry';
import { regionDef } from '../src/campaign/regions';

/** Battles are left unfought: these tests are about decisions, not the battle simulation. */
const noBattles: AiContext = { battles: async () => [] };

/**
 * A quick stand-in for the battle simulation: the stronger side wins and
 * each side loses a share of its men, applied through the real campaign
 * bookkeeping. Deterministic and instant.
 */
function quickBattles(s: CampaignState): AiContext {
  return {
    battles: async (pbs) => {
      const out = [];
      for (const pb0 of pbs) {
        const pb = refreshBattle(s, pb0);
        if (!pb) continue;
        const prep = prepareBattle(s, pb, { auto: true, unitScale: 0.2 });
        const atkWins = attackerPower(s, pb) > defenderPower(s, pb) * 0.8;
        const side = (i: 0 | 1): SideSummary => {
          const won = (i === prep.attackerSide) === atkWins;
          const units = prep.setup.armies[i].units.map((u, k) => ({ id: k, def: u.def, name: u.def, start: 20, alive: won ? 16 : 6, kills: 2, damageDealt: 0, state: 'ready' as const, cost: 500, hp: won ? 0.8 : 0.3 }));
          return { faction: prep.setup.armies[i].faction, soldiersStart: units.length * 20, soldiersLost: units.length * (won ? 4 : 14), costStart: units.length * 500, costLost: units.length * (won ? 100 : 350), units };
        };
        const result: BattleResult = { winner: atkWins ? prep.attackerSide : ((1 - prep.attackerSide) as 0 | 1), reason: 'rout', time: 100, sides: [side(0), side(1)] };
        out.push(applyBattle(s, pb, prep, result, { fought: false }));
      }
      return out;
    },
  };
}

async function aiRound(s: CampaignState): Promise<void> {
  for (const f of FACTION_IDS) await scriptedAI(s, f, quickBattles(s));
  endRound(s);
}

afterEach(() => {
  setJevProvider(null);
  vi.useRealTimers();
});

describe('scripted campaign AI', () => {
  it('replays identically from the same seed', async () => {
    const a = newCampaign({ faction: 'vesperate', seed: 3 });
    const b = newCampaign({ faction: 'vesperate', seed: 3 });
    for (let i = 0; i < 5; i++) {
      await aiRound(a);
      await aiRound(b);
    }
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it('spends its treasury on buildings and troops in the first Tolls', async () => {
    const s = newCampaign({ faction: 'vesperate', seed: 4 });
    const built = (f: string) => Object.values(s.regions).reduce((t, r) => t + (r.owner === f ? r.slots.filter((x) => x && (x.level > 0 || x.building)).length : 0), 0);
    const before = Object.fromEntries(FACTION_IDS.map((f) => [f, built(f)]));
    const units = (f: string) => s.armies.filter((a) => a.faction === f).reduce((t, a) => t + a.units.length, 0);
    const unitsBefore = Object.fromEntries(FACTION_IDS.map((f) => [f, units(f)]));
    const owned = (f: string) => Object.values(s.regions).filter((r) => r.owner === f).length;
    const landBefore = Object.fromEntries(FACTION_IDS.map((f) => [f, owned(f)]));
    const cityWork = () => s.armies.filter((a) => a.faction === 'drift').reduce((t, a) => t + a.city!.level * 10 + a.city!.slots.reduce((u, x) => u + (x ? x.level + (x.building ? 1 : 0) : 0), 0), 0);
    const cityBefore = cityWork();
    for (let i = 0; i < 6; i++) await aiRound(s);
    for (const f of ['choir', 'hush', 'vesperate'] as const) {
      expect(built(f)).toBeGreaterThan(before[f]!);
      // Expand into free land nearby.
      expect(owned(f)).toBeGreaterThan(landBefore[f]!);
    }
    // Troops wait on bread and on armies coming home to recruit, but some come early.
    const land = ['choir', 'hush', 'vesperate'] as const;
    expect(land.reduce((t, f) => t + units(f), 0)).toBeGreaterThan(land.reduce((t, f) => t + unitsBefore[f]!, 0));
    // The Drift build into their wind-cities instead, and tie moorings.
    expect(cityWork()).toBeGreaterThan(cityBefore);
    expect(Object.values(s.regions).some((r) => r.mooring)).toBe(true);
  });

  it('explains its view without changing anything', () => {
    const s = newCampaign({ faction: 'choir', seed: 2 });
    const before = JSON.stringify(s);
    const x = aiExplain(s, 'hush');
    expect(x.armies.length).toBeGreaterThan(0);
    expect(x.targets.length).toBeGreaterThan(0);
    expect(JSON.stringify(s)).toBe(before);
  });

  it('rebuilds a town that trains the line when it has lost every one', async () => {
    const s = newCampaign({ faction: 'vesperate', seed: 6 });
    const line = (id: string) => /\.(barracks|range)$/.test(id);
    for (const r of Object.values(s.regions)) {
      if (r.owner !== 'choir') continue;
      r.slots = r.slots.map((x) => (x && line(x.chain) ? null : x));
    }
    s.factions.choir.coin = 20000;
    await scriptedAI(s, 'choir', noBattles);
    const rebuilt = Object.values(s.regions).some((r) => r.owner === 'choir' && r.slots.some((x) => x && line(x.chain)));
    expect(rebuilt).toBe(true);
  });
});

describe('recruiting', () => {
  it('draws recruits from the best-equipped town in reach, not a busy market town next door', () => {
    const s = newCampaign({ faction: 'vesperate', seed: 5 });
    const cap = 'vesper';
    const village = neighbors(cap).find((id) => regionDef(id).settlement && s.regions[id]!.owner !== 'vesperate')!;
    const v = s.regions[village]!;
    v.owner = 'vesperate';
    v.level = s.regions[cap]!.level;
    // As big as the capital and more built up, but nothing that trains troops.
    v.slots = s.regions[cap]!.slots.map(() => ({ chain: 'vesperate.market', level: 1 }));
    const a = s.armies.find((x) => x.faction === 'vesperate')!;
    a.region = village;
    expect(recruitSite(s, a)!.region).toBe(cap);
    expect(recruitOptions(s, a.id).some((o) => o.ok)).toBe(true);
  });
});

describe('AI offers to the player', () => {
  const losingHush = (): CampaignState => {
    const s = newCampaign({ faction: 'choir', seed: 6 });
    s.turn = 12;
    relation(s, 'choir', 'hush').since = 1;
    s.factions.choir.coin = 30000;
    s.armies = s.armies.filter((a) => a.faction !== 'hush' || a.lord.legendary);
    for (const a of s.armies) if (a.faction === 'hush') a.units = a.units.slice(0, 2);
    return s;
  };

  it('offers peace when losing a war with the player, at most once every few Tolls', async () => {
    const s = losingHush();
    const offered: Deal[] = [];
    const ctx: AiContext = { ...noBattles, offer: async (d) => (offered.push(d), false) };
    await scriptedAI(s, 'hush', ctx);
    expect(offered).toEqual([{ kind: 'peace', from: 'hush', to: 'choir' }]);
    s.turn++;
    await scriptedAI(s, 'hush', ctx);
    expect(offered).toHaveLength(1);
  });

  it('applies a deal the player accepts, and asks no one without a hook', async () => {
    const s = losingHush();
    const deal: Deal = { kind: 'peace', from: 'hush', to: 'choir' };
    const silent: TurnHooks = { playerBattle: async () => Promise.reject(new Error('no battles')) };
    expect(await offerToPlayer(s, deal, silent)).toBe(false);
    expect(relation(s, 'choir', 'hush').stance).toBe('war');
    let seen = 0;
    const yes: TurnHooks = { ...silent, offer: async (_s, d, value) => (seen++, expect(d).toBe(deal), expect(typeof value.value).toBe('number'), true) };
    expect(await offerToPlayer(s, deal, yes)).toBe(true);
    expect(seen).toBe(1);
    expect(relation(s, 'choir', 'hush').stance).toBe('peace');
  });
});

describe('Jev', () => {
  const jevOn = (seed = 8): CampaignState => {
    const s = newCampaign({ faction: 'vesperate', seed });
    s.options.jev = true;
    s.turn = 20;
    return s;
  };
  const provider = (answer: (options: { id: string }[]) => Promise<{ choice: string; confidence: number }>): JevProvider & { calls: number } => {
    const p = {
      calls: 0,
      async choose(_f: string, _situation: string, options: { id: string }[]) {
        p.calls++;
        return answer(options);
      },
    };
    return p as JevProvider & { calls: number };
  };

  it('is off by default and when no provider is set', async () => {
    const s = jevOn();
    expect(await consultJev(s, 'hush')).toBeNull();
    const p = provider(async () => ({ choice: 'war:drift', confidence: 1 }));
    setJevProvider(p);
    s.options.jev = false;
    expect(await consultJev(s, 'hush')).toBeNull();
    expect(p.calls).toBe(0);
  });

  it('describes the situation in words and offers only legal choices', () => {
    const s = jevOn();
    const text = situationFor(s, 'hush');
    expect(text).toMatch(/Treasury (in debt|nearly empty|modest|comfortable|rich)/);
    expect(text).toMatch(/Vesperate/);
    expect(text).not.toMatch(/\b\d{4,}\b/);
    const ids = optionsFor(s, 'hush').map((o) => o.id);
    expect(ids).toContain('keep');
    expect(ids).toContain('peace:choir');
    expect(ids).toContain('war:drift');
    expect(ids).not.toContain('war:choir');
  });

  it('offers no war of choice in the first Tolls, soon after a treaty, or on a third front', () => {
    const s = jevOn();
    s.turn = JEV_WAR_FROM - 1;
    expect(optionsFor(s, 'hush').some((o) => o.id.startsWith('war:'))).toBe(false);
    s.turn = 30;
    relation(s, 'hush', 'drift').since = 25;
    expect(optionsFor(s, 'hush').map((o) => o.id)).not.toContain('war:drift');
    relation(s, 'hush', 'drift').since = 0;
    expect(optionsFor(s, 'hush').map((o) => o.id)).toContain('war:drift');
    relation(s, 'hush', 'vesperate').stance = 'war';
    expect(optionsFor(s, 'hush').some((o) => o.id.startsWith('war:'))).toBe(false);
  });

  it('applies a confident choice once per Toll, and the chronicle hears why', async () => {
    const s = jevOn();
    const p = provider(async () => ({ choice: 'war:drift', confidence: 0.9, reason: 'The wind-cities grow fat on our furs.' }));
    setJevProvider(p);
    const pick = await consultJev(s, 'hush');
    expect(pick?.choice).toBe('war:drift');
    expect(relation(s, 'hush', 'drift').stance).toBe('war');
    expect(s.factions.hush.ai?.holdWar?.target).toBe('drift');
    const told = s.events.filter((e) => e.by === 'jev');
    expect(told).toHaveLength(1);
    expect(told[0]!.text).toContain('"The wind-cities grow fat on our furs."');
    expect(told[0]!.faction).toBeUndefined();
    expect(await consultJev(s, 'hush')).toBeNull();
    expect(p.calls).toBe(1);
  });

  it('keeps a change of plan out of the chronicle unless the player is an ally', async () => {
    const s = jevOn();
    setJevProvider(provider(async () => ({ choice: 'focus:defend', confidence: 0.9, reason: 'Hold the Pole.' })));
    await consultJev(s, 'hush');
    expect(s.factions.hush.ai?.focus?.kind).toBe('defend');
    expect(s.events.some((e) => e.by === 'jev')).toBe(false);
  });

  it('keeps the plan when unsure, wrong or failing', async () => {
    const s = jevOn();
    setJevProvider(provider(async () => ({ choice: 'war:drift', confidence: 0.2 })));
    expect(await consultJev(s, 'hush')).toBeNull();
    s.turn++;
    setJevProvider(provider(async () => ({ choice: 'war:everyone', confidence: 1 })));
    expect(await consultJev(s, 'hush')).toBeNull();
    s.turn++;
    setJevProvider(provider(async () => Promise.reject(new Error('offline'))));
    expect(await consultJev(s, 'hush')).toBeNull();
    expect(relation(s, 'hush', 'drift').stance).toBe('peace');
  });

  it('gives up on a slow advisor, aborts it, and the scripted AI carries on', async () => {
    vi.useFakeTimers();
    const s = jevOn();
    let aborted = false;
    setJevProvider({
      async choose(_f, _situation, _options, signal) {
        signal?.addEventListener('abort', () => (aborted = true));
        return new Promise(() => {});
      },
    });
    const pending = consultJev(s, 'hush');
    await vi.advanceTimersByTimeAsync(JEV_TIMEOUT_MS + 10);
    expect(await pending).toBeNull();
    expect(aborted).toBe(true);
    vi.useRealTimers();
    // The faction still plays its Toll.
    await scriptedAI(s, 'hush', noBattles);
    expect(s.factions.hush.alive).toBe(true);
  });

  it('waits as long as the provider asks', async () => {
    vi.useFakeTimers();
    const s = jevOn();
    setJevProvider({
      timeoutMs: 8000,
      choose: () => new Promise((resolve) => setTimeout(() => resolve({ choice: 'war:drift', confidence: 1 }), 6000)),
    });
    const pending = consultJev(s, 'hush');
    await vi.advanceTimersByTimeAsync(6500);
    expect((await pending)?.choice).toBe('war:drift');
  });

  it('asks every faction at once before they move, and each uses its own answer', async () => {
    vi.useFakeTimers();
    const s = jevOn();
    const asked: string[] = [];
    setJevProvider({
      timeoutMs: 8000,
      choose: (f) => {
        asked.push(f);
        return new Promise((resolve) => setTimeout(() => resolve({ choice: f === 'hush' ? 'war:drift' : 'keep', confidence: 1 }), 2000));
      },
    });
    prefetchJev(s);
    // The three AI factions, not the player.
    expect(asked.sort()).toEqual(['choir', 'drift', 'hush']);
    const hush = consultJev(s, 'hush');
    const choir = consultJev(s, 'choir');
    await vi.advanceTimersByTimeAsync(2100);
    expect((await hush)?.choice).toBe('war:drift');
    expect(await choir).toBeNull();
    expect(asked).toHaveLength(3);
    vi.useRealTimers();
  });

  it('checks a prefetched answer against the options when the faction moves', async () => {
    const s = jevOn();
    setJevProvider({ choose: async () => ({ choice: 'war:drift', confidence: 1 }) });
    prefetchJev(s);
    // Another faction's move made the choice moot: they are at war already.
    relation(s, 'hush', 'drift').stance = 'war';
    expect(await consultJev(s, 'hush')).toBeNull();
  });

  it('consults each faction only every few Tolls when the provider asks for that', async () => {
    const s = jevOn();
    let calls = 0;
    setJevProvider({ every: 2, choose: async () => (calls++, { choice: 'keep', confidence: 1 }) });
    for (let t = 0; t < 4; t++) {
      await consultJev(s, 'hush');
      s.turn++;
    }
    expect(calls).toBe(2);
    // Staggered: the factions do not all ask on the same Toll.
    calls = 0;
    prefetchJev(s);
    const first = calls;
    s.turn++;
    prefetchJev(s);
    expect(first).toBeGreaterThan(0);
    expect(calls - first).toBeGreaterThan(0);
    expect(calls).toBe(3);
  });
});
