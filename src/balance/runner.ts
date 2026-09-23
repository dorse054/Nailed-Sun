/**
 * Runs balance jobs headless and boils each battle down to a small result.
 * Pure TypeScript with no DOM or Node APIs, so Node worker threads, the
 * in-game Balance Lab's Web Worker and tests all share it.
 *
 * Deterministic: the same job gives the same result anywhere, because the
 * battle, its AI and its terrain are all seeded from the job's setup.
 */
import { BattleAI } from '../ai/battleAI';
import { Battle } from '../sim/battle';
import type { Controller } from '../sim/battle';
import type { BattleResult, Side } from '../sim/types';
import type { FactionId } from '../data/schema';
import type { BalanceJob, JobTags, SuiteId } from './suites';
import { DuelAI } from './duelAI';

export interface SideOutcome {
  faction: FactionId;
  /** Points fielded (sum of unit costs). */
  cost: number;
  /** Share of the side's points whose soldiers were killed (0..1). */
  killed: number;
  /** Share of the side's points out of the fight at the end: killed, routed, shattered or fled (0..1). */
  removed: number;
  /**
   * Like `removed`, but wounds count too: a unit still fighting keeps only
   * the share of its starting hit points it has left. This is what the
   * efficiency numbers use, since a colossus or monster otherwise counts as
   * untouched until it dies.
   */
  lost: number;
  soldiers: number;
  soldiersLost: number;
}

export interface JobResult {
  id: string;
  suite: SuiteId;
  tags: JobTags;
  winner: Side | -1;
  reason: BattleResult['reason'] | 'error' | 'aborted';
  /** Simulated seconds. */
  time: number;
  /** Wall-clock milliseconds spent simulating. */
  cpuMs: number;
  sides: [SideOutcome, SideOutcome];
  /** Duels: forced attack orders the duel harness had to give. */
  forced?: number;
  /** Battles on the timer: unit ids still fighting on each side, to see what drags battles out. */
  standing?: [string[], string[]];
  /** Set when the simulation threw. */
  error?: string;
  /** Simulated time when a NaN position, HP or morale first appeared. */
  nanAt?: number;
}

export interface RunOptions {
  /** Wall-clock budget per battle in ms; a battle over it is stopped and scored as it stands. */
  wallLimitMs?: number;
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

function controllerFor(job: BalanceJob): [Controller, Controller] {
  if (job.suite === 'duels') return [new DuelAI(), new DuelAI()];
  return [new BattleAI(), new BattleAI()];
}

/** First NaN found among soldiers and units, or null. */
function findNaN(b: Battle): string | null {
  for (const s of b.soldiers) {
    if (!s.alive) continue;
    if (!Number.isFinite(s.x) || !Number.isFinite(s.y) || Number.isNaN(s.hp)) return `soldier ${s.id} of ${s.unit.def.id}`;
  }
  for (const u of b.units) {
    if (u.alive > 0 && (!Number.isFinite(u.x) || !Number.isFinite(u.y) || Number.isNaN(u.morale))) return `unit ${u.def.id}`;
  }
  return null;
}

/** Share of a side's points still fighting, weighted by hit points left. */
function hpValueLeft(b: Battle, side: Side): number {
  let start = 0;
  let left = 0;
  for (const u of b.units) {
    if (u.side !== side) continue;
    start += u.cost;
    if ((u.state !== 'ready' && u.state !== 'embarked') || u.hpStart <= 0) continue;
    let hp = 0;
    for (const s of u.soldiers) if (s.alive) hp += Math.max(0, s.hp);
    left += u.cost * Math.min(1, hp / u.hpStart);
  }
  return start > 0 ? left / start : 0;
}

function outcome(b: Battle, r: BattleResult, side: Side): SideOutcome {
  const s = r.sides[side];
  return {
    faction: s.faction,
    cost: s.costStart,
    killed: s.costStart > 0 ? s.costLost / s.costStart : 0,
    removed: 1 - b.remainingValue(side),
    lost: 1 - hpValueLeft(b, side),
    soldiers: s.soldiersStart,
    soldiersLost: s.soldiersLost,
  };
}

function emptySide(job: BalanceJob, side: Side): SideOutcome {
  return { faction: job.tags.factions[side], cost: job.tags.costs[side], killed: 0, removed: 0, lost: 0, soldiers: 0, soldiersLost: 0 };
}

export function runJob(job: BalanceJob, opts: RunOptions = {}): JobResult {
  const t0 = now();
  const wallLimit = opts.wallLimitMs ?? 120_000;
  let b: Battle | null = null;
  let nanAt: number | undefined;
  let nanWhat: string | null = null;
  const ais = controllerFor(job);
  try {
    b = new Battle(job.setup, { events: false });
    b.setController(0, ais[0]);
    b.setController(1, ais[1]);
    const maxTicks = Math.ceil(job.maxSeconds * 20);
    let aborted = false;
    while (!b.over && b.tick < maxTicks) {
      b.step();
      if (b.tick % 200 === 0) {
        if (nanAt === undefined) {
          nanWhat = findNaN(b);
          if (nanWhat) nanAt = b.time;
        }
        if (now() - t0 > wallLimit) {
          aborted = true;
          break;
        }
      }
    }
    // Scores the battle as a timeout if it is still going (remaining value decides).
    const r = b.result ?? b.run(0);
    if (nanAt === undefined) {
      nanWhat = findNaN(b);
      if (nanWhat) nanAt = b.time;
    }
    const res: JobResult = {
      id: job.id,
      suite: job.suite,
      tags: job.tags,
      winner: r.winner,
      reason: aborted ? 'aborted' : r.reason,
      time: r.time,
      cpuMs: now() - t0,
      sides: [outcome(b, r, 0), outcome(b, r, 1)],
    };
    if (job.suite === 'duels') res.forced = (ais[0] as DuelAI).forcedOrders + (ais[1] as DuelAI).forcedOrders;
    if (res.reason === 'timeout' || res.reason === 'aborted') {
      const up = (side: Side): string[] => b!.units.filter((u) => u.side === side && u.alive > 0 && (u.state === 'ready' || u.state === 'embarked')).map((u) => u.def.id);
      res.standing = [up(0), up(1)];
    }
    if (nanAt !== undefined) {
      res.nanAt = nanAt;
      res.error = `NaN in ${nanWhat}`;
    }
    return res;
  } catch (e) {
    const err = e instanceof Error ? `${e.message}\n${(e.stack ?? '').split('\n').slice(1, 4).join('\n')}` : String(e);
    return {
      id: job.id,
      suite: job.suite,
      tags: job.tags,
      winner: -1,
      reason: 'error',
      time: b?.time ?? 0,
      cpuMs: now() - t0,
      sides: [emptySide(job, 0), emptySide(job, 1)],
      error: err,
    };
  }
}

/** Run jobs one after another in this thread. */
export function runJobs(jobs: readonly BalanceJob[], onResult?: (r: JobResult, done: number, total: number) => void, opts: RunOptions = {}): JobResult[] {
  const out: JobResult[] = [];
  for (const job of jobs) {
    const r = runJob(job, opts);
    out.push(r);
    onResult?.(r, out.length, jobs.length);
  }
  return out;
}

/** Score of side 0: 1 for a win, 0.5 for a draw, 0 for a loss. */
export function score0(r: JobResult): number {
  return r.winner === 0 ? 1 : r.winner === -1 ? 0.5 : 0;
}

/** Score of a side. */
export function scoreOf(r: JobResult, side: Side): number {
  const s = score0(r);
  return side === 0 ? s : 1 - s;
}

/** Relative cost of a job, used to hand out long jobs first. */
export function jobWeight(job: BalanceJob): number {
  const n = job.tags.costs[0] + job.tags.costs[1];
  const scale = job.setup.unitScale ?? 1;
  return (n / 1000) * (0.3 + scale) * (job.suite === 'duels' ? 0.5 : 1);
}
