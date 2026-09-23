/**
 * Runs a round: the AI factions take their Tolls in turn, their battles are
 * simulated in parallel (or put to the player when the player is involved),
 * and then the world moves on.
 */
import type { FactionId } from '../data/schema';
import { FACTION_IDS } from '../data/schema';
import type { BattleResult } from '../sim/types';
import { simulate } from '../sim/pool';
import type { BattleReport, CampaignState, PendingBattle } from './types';
import { applyBattle, prepareBattle, AUTO_SCALE, type PreparedBattle } from './battles';
import { hostileArmiesIn, hostileSettlement } from './actions';
import { armyById, log, relation } from './state';
import { regionDef } from './regions';
import { endRound } from './turn';
import { accept, valueDeal, type Deal, type DealValue } from './diplomacy';

export interface PlayerBattleOutcome {
  prep: PreparedBattle;
  result: BattleResult;
  fought: boolean;
  driftChoice?: 'sack' | 'moor';
  /** The attacker backed off: no battle. */
  cancelled?: boolean;
}

export interface TurnHooks {
  /** The player takes part: fight it, or let the simulation decide. */
  playerBattle(s: CampaignState, pb: PendingBattle): Promise<PlayerBattleOutcome>;
  /** Which AI faction is moving now. */
  progress?(faction: FactionId): void;
  /**
   * An AI faction puts a deal to the player; resolve true to accept. The
   * proposer is the side that is not the player (`deal.from`, except for a
   * tribute demand, `demand: true`, where the player `deal.to` would pay).
   * `value` is the deal as the player's faction would weigh it. Without
   * this hook the AI makes no offers to the player.
   */
  offer?(s: CampaignState, deal: Deal, value: DealValue): Promise<boolean>;
}

export interface AiContext {
  /** Settle a set of battles this faction started, then continue. */
  battles(pbs: PendingBattle[]): Promise<BattleReport[]>;
  /** Put a deal to the player. Resolves false when declined or when no one is there to ask. */
  offer?(deal: Deal): Promise<boolean>;
}

/** Ask the player about an AI offer; an accepted deal is applied at once. */
export async function offerToPlayer(s: CampaignState, deal: Deal, hooks: TurnHooks): Promise<boolean> {
  if (!hooks.offer) return false;
  const yes = await hooks.offer(s, deal, valueDeal(s, deal));
  if (yes) return accept(s, deal);
  // A refused demand rankles; a refused offer a little.
  const ai = deal.to === s.player ? deal.from : deal.to;
  relation(s, ai, s.player).opinion -= deal.demand ? 5 : 1;
  return false;
}

export type FactionAI = (s: CampaignState, f: FactionId, ctx: AiContext) => Promise<void>;

/**
 * A battle can go stale while others resolve: the attacker may be gone, or
 * the defenders may have fled. Rebuild it from the current state.
 */
export function refreshBattle(s: CampaignState, pb: PendingBattle): PendingBattle | null {
  const atk = pb.attacker.armies.filter((id) => armyById(s, id));
  if (!atk.length) return null;
  const first = armyById(s, atk[0]!)!;
  const enemies = hostileArmiesIn(s, pb.region, first.faction);
  const settlement = hostileSettlement(s, pb.region, first.faction);
  if (!enemies.length && !(pb.assault && settlement)) {
    // Nothing left to fight: march in.
    for (const id of atk) {
      const a = armyById(s, id)!;
      a.region = pb.region;
      a.from = pb.from;
      a.moves = 0;
    }
    return null;
  }
  const defFaction = enemies.length ? enemies[0]!.faction : s.regions[pb.region]!.owner;
  return {
    ...pb,
    attacker: { faction: pb.attacker.faction, armies: atk },
    defender: {
      faction: defFaction,
      armies: enemies.filter((e) => e.faction === defFaction).map((e) => e.id),
      garrison: !!regionDef(pb.region).settlement && s.regions[pb.region]!.owner === defFaction,
    },
    assault: pb.assault || (!!regionDef(pb.region).settlement && s.regions[pb.region]!.owner === defFaction),
  };
}

function involvesPlayer(s: CampaignState, pb: PendingBattle): boolean {
  return pb.attacker.faction === s.player || pb.defender.faction === s.player;
}

/** Splits battles into waves that share no armies or regions. */
function waves(pbs: PendingBattle[]): PendingBattle[][] {
  const out: PendingBattle[][] = [];
  let cur: PendingBattle[] = [];
  const used = new Set<string>();
  for (const pb of pbs) {
    const keys = [pb.region, ...pb.attacker.armies, ...pb.defender.armies];
    if (keys.some((k) => used.has(k))) {
      out.push(cur);
      cur = [];
      used.clear();
    }
    cur.push(pb);
    for (const k of keys) used.add(k);
  }
  if (cur.length) out.push(cur);
  return out;
}

export async function resolveBattles(s: CampaignState, pbs: PendingBattle[], hooks: TurnHooks): Promise<BattleReport[]> {
  const reports: BattleReport[] = [];
  for (const wave of waves(pbs)) {
    const fresh = wave.map((pb) => refreshBattle(s, pb)).filter((x): x is PendingBattle => !!x);
    // Start every AI-only battle at once; ask the player about theirs meanwhile.
    const jobs = fresh.map((pb) => {
      if (involvesPlayer(s, pb)) return null;
      const prep = prepareBattle(s, pb, { auto: true, unitScale: AUTO_SCALE });
      return { prep, done: simulate(prep.setup) };
    });
    const outcomes: (PlayerBattleOutcome | null)[] = [];
    for (let i = 0; i < fresh.length; i++) {
      const pb = fresh[i]!;
      if (jobs[i]) outcomes.push(null);
      else outcomes.push(await hooks.playerBattle(s, pb));
    }
    for (let i = 0; i < fresh.length; i++) {
      const pb = fresh[i]!;
      const job = jobs[i];
      if (job) {
        const result = await job.done;
        reports.push(applyBattle(s, pb, job.prep, result, { fought: false }));
      } else {
        const o = outcomes[i]!;
        if (o.cancelled) continue;
        reports.push(applyBattle(s, pb, o.prep, o.result, { fought: o.fought, driftChoice: o.driftChoice }));
      }
    }
  }
  return reports;
}

/** The player ends their Toll: every AI faction moves, then the world turns. */
export async function endTurn(s: CampaignState, hooks: TurnHooks, ai: FactionAI): Promise<void> {
  for (const f of FACTION_IDS) {
    if (f === s.player || !s.factions[f].alive || s.winner) continue;
    hooks.progress?.(f);
    try {
      await ai(s, f, { battles: (pbs) => resolveBattles(s, pbs, hooks), offer: (deal) => offerToPlayer(s, deal, hooks) });
    } catch (e) {
      // An AI bug must never end the campaign.
      log(s, 'warning', `The ${f} hesitate this Toll.`);
      console.error(e);
    }
  }
  endRound(s);
}
