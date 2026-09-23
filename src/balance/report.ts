/**
 * Turns balance results into the doc's checks: a faction win-rate matrix,
 * best and worst conditions, colossus results, role efficiency, counters and
 * the cost formula, plus a list of flags wherever a target is missed.
 *
 * Every rate carries a 95% interval. A miss whose whole interval lies outside
 * the target band is a "fail" (real); a miss the interval still overlaps is a
 * "warn" (could be noise: run more seeds). The same report object renders as
 * JSON (for tools and the Balance Lab) and as Markdown (for people).
 */
import type { FactionId, Role } from '../data/schema';
import { FACTION_IDS, LIGHT_NAMES, WIND_NAMES } from '../data/schema';
import { hasUnit, unitDef } from '../data/index';
import { CONDITIONS } from './conditions';
import type { CostBreakdown, CostFamily } from './formula';
import { costFormulaTable, formulaK } from './formula';
import type { JobResult } from './runner';
import { score0, scoreOf } from './runner';
import type { SuiteId } from './suites';
import { duelUnits } from './suites';
import type { Rate } from './stats';
import { bandSeverity, median, rate, ratioInterval, Tally } from './stats';

/** The doc's targets. */
export const TARGETS = {
  factionAvg: { min: 0.45, max: 0.55 },
  factionCond: { min: 0.4, max: 0.6 },
  efficiency: 0.1,
  counters: 2,
  counterRate: 0.6,
  colossus: { min: 0.4, max: 0.5 },
  /** Formula deviations beyond this are listed (informational; not a doc target). */
  formula: 0.25,
  /** Fewest battles in a condition cell before it can raise a target-2 flag. */
  minCell: 6,
} as const;

/**
 * The doc's counters table (role -> roles it should beat), as the battle AI
 * also encodes it in src/ai/battleAI.ts. Duels check each relation.
 */
export const DOC_COUNTERS: Partial<Record<Role, Role[]>> = {
  line: ['antiLarge', 'shockCav'],
  antiLarge: ['shockCav', 'monster', 'missileCav'],
  shock: ['line'],
  missile: ['monster'],
  shockCav: ['missile', 'artillery', 'support', 'missileCav'],
  missileCav: ['monster'],
  monster: ['line', 'shock', 'missile', 'support'],
  artillery: ['monster'],
  flyer: ['artillery', 'missile'],
};

export type TargetId = 1 | 2 | 3 | 4 | 5;
export type Severity = 'fail' | 'warn' | 'info';

export interface Flag {
  /** 'roles': a relation of the doc's counters table that the duels contradict. */
  target: TargetId | 'sim' | 'formula' | 'roles';
  severity: Severity;
  subject: string;
  message: string;
  value?: number;
  lo?: number;
  hi?: number;
}

export interface TargetStatus {
  id: TargetId;
  name: string;
  goal: string;
  /** 'thin': the suite ran but no cell had enough battles to judge. */
  status: 'pass' | 'warn' | 'fail' | 'thin' | 'not run';
  summary: string;
}

export interface ReportMeta {
  generated: string;
  commit?: string;
  command?: string;
  settings: Record<string, unknown>;
  timing?: Partial<Record<SuiteId, { jobs: number; wallMs: number; cpuMs: number }>>;
  machine?: string;
}

export interface FactionSection {
  factions: FactionId[];
  battles: number;
  conditions: number[];
  /** matrix[a][b]: a's win rate against b, averaged over every condition run. */
  matrix: Partial<Record<FactionId, Partial<Record<FactionId, Rate>>>>;
  vsField: Partial<Record<FactionId, Rate>>;
  /** Win rate against the field in each condition (index = condition index; n = 0 when not run). */
  byCondition: Partial<Record<FactionId, Rate[]>>;
  /** "a~b" -> a's win rate against b per light level (Dark..Blaze). */
  pairByLight: Record<string, Rate[]>;
  /** "a~b" -> a's win rate against b per wind (Calm, Breeze, Gale). */
  pairByWind: Record<string, Rate[]>;
  best: Partial<Record<FactionId, { cond: number; rate: Rate }>>;
  worst: Partial<Record<FactionId, { cond: number; rate: Rate }>>;
  /** Side 0 (bottom edge) win rate: should sit near 50%. */
  side0: Rate;
  side0BySun: Record<string, Rate>;
  /** Battles where only one army rolled its colossus: that army's win rate. */
  colossusEdge: Rate;
  /** Condition cells with enough battles to judge target 2, and cells skipped for too few. */
  judgedCells: number;
  thinCells: number;
  timeouts: number;
  draws: number;
  meanTime: number;
}

export interface DuelUnitRow {
  id: string;
  name: string;
  faction: FactionId;
  role: Role;
  cost: number;
  duels: number;
  winRate: Rate;
  /** Enemy value destroyed per point of own value lost (wounds count), over all duels. */
  exchange: number;
  exchangeLo: number;
  exchangeHi: number;
  roleMedian: number;
  /** exchange / role median - 1. */
  deviation: number;
  devLo: number;
  devHi: number;
  severity?: Severity;
}

export interface CounterCell {
  counters: { id: string; name: string; cost: number; rate: number }[];
  /** Enemy units that cost no more than this one. */
  candidates: number;
  status: 'pass' | 'fail' | 'impossible';
}

export interface CounterRow {
  id: string;
  name: string;
  faction: FactionId;
  cost: number;
  byFaction: Partial<Record<FactionId, CounterCell>>;
}

export interface DuelSection {
  battles: number;
  timeouts: number;
  /** Timeouts where neither side lost 5% of its value: the duel never really happened. */
  stalls: number;
  forcedShare: number;
  units: DuelUnitRow[];
  roles: { role: Role; median: number; units: number }[];
  /** roleGrid[a][b]: win rate of role-a units against role-b units at equal cost. */
  roleGrid: Partial<Record<Role, Partial<Record<Role, Rate>>>>;
  /** Each relation of the doc's counters table with the duel win rate that tests it. */
  counterTable: { role: Role; beats: Role; rate: Rate; holds: boolean }[];
  counters: CounterRow[];
  /** pairs[a][b] = [a's win rate against b, duels]. */
  pairs: Record<string, Record<string, [number, number]>>;
}

export interface ColossusRow {
  id: string;
  name: string;
  faction: FactionId;
  vsArms: Rate;
  byFaction: Partial<Record<FactionId, Rate>>;
  byLight: Rate[];
  meanTime: number;
  timeouts: number;
  meanArmsCost: number;
  /** Mean share of the colossus's value lost (hit points) and of the arms' value lost. */
  meanLost: number;
  meanArmsLost: number;
  severity?: Severity;
}

export interface ColossusSection {
  battles: number;
  rows: ColossusRow[];
}

export interface HealthSection {
  jobs: number;
  bySuite: Partial<Record<SuiteId, { jobs: number; timeouts: number; meanTime: number; meanCpuMs: number }>>;
  /** Faction battles on the timer: how often each unit was still standing on the side that was behind. */
  timeoutHoldouts: { id: string; name: string; count: number }[];
  errors: { id: string; error: string }[];
  nans: { id: string; at: number; what: string }[];
  aborted: string[];
}

export interface BalanceReport {
  meta: ReportMeta;
  targets: TargetStatus[];
  flags: Flag[];
  factions?: FactionSection;
  duels?: DuelSection;
  colossus?: ColossusSection;
  formula: { k: Partial<Record<CostFamily, number>>; rows: CostBreakdown[] };
  health: HealthSection;
}

const TARGET_TEXT: Record<TargetId, { name: string; goal: string }> = {
  1: { name: 'Faction vs faction, all conditions', goal: '45–55% wins at equal cost, averaged over every light and wind condition' },
  2: { name: 'Best and worst conditions', goal: 'never above 60% or below 40% in a faction’s best or worst condition' },
  3: { name: 'Cost efficiency in role', goal: 'within ±10% of the role median' },
  4: { name: 'Counters', goal: 'at least 2 counters in each enemy faction that cost no more' },
  5: { name: 'Colossus vs combined arms', goal: 'the colossus wins 40–50% against equal cost' },
};

// ------------------------------------------------------------------- build

export function buildReport(results: readonly JobResult[], meta: ReportMeta): BalanceReport {
  const bySuite = (s: SuiteId) => results.filter((r) => r.suite === s && r.reason !== 'error');
  const flags: Flag[] = [];
  const factions = factionSection(bySuite('factions'), flags);
  const duels = duelSection(bySuite('duels'), flags);
  const colossus = colossusSection(bySuite('colossus'), flags);
  const health = healthSection(results, flags);
  const rows = costFormulaTable();
  const k: Partial<Record<CostFamily, number>> = {};
  for (const [fam, v] of formulaK()) k[fam] = Math.round(v * 1000) / 1000;
  const worstFormula = rows.filter((r) => Math.abs(r.deviation) > TARGETS.formula).sort((a, b) => Math.abs(b.deviation) - Math.abs(a.deviation));
  for (const r of worstFormula) {
    flags.push({
      target: 'formula',
      severity: 'info',
      subject: r.id,
      value: r.deviation,
      message: `${r.name} costs ${r.cost}; the cost formula (k for ${r.family}) gives ${r.formula} (${signedPct(r.deviation)}).`,
    });
  }
  const targets = targetStatus(flags, { factions, duels, colossus });
  flags.sort(flagOrder);
  return { meta, targets, flags, factions, duels, colossus, formula: { k, rows }, health };
}

/** How far a flag misses its target, so the worst come first within a target. */
function flagMagnitude(f: Flag): number {
  const v = f.value;
  if (v === undefined) return 0;
  switch (f.target) {
    case 1:
      return Math.max(TARGETS.factionAvg.min - v, v - TARGETS.factionAvg.max);
    case 2:
      return Math.max(TARGETS.factionCond.min - v, v - TARGETS.factionCond.max);
    case 5:
      return Math.max(TARGETS.colossus.min - v, v - TARGETS.colossus.max);
    case 4:
      return TARGETS.counters - v;
    default:
      return Math.abs(v);
  }
}

function flagOrder(a: Flag, b: Flag): number {
  const sev = { fail: 0, warn: 1, info: 2 } as const;
  if (sev[a.severity] !== sev[b.severity]) return sev[a.severity] - sev[b.severity];
  const rank = (t: Flag['target']): number => (typeof t === 'number' ? t : t === 'sim' ? 0 : t === 'roles' ? 8 : 9);
  const ta = rank(a.target);
  const tb = rank(b.target);
  if (ta !== tb) return ta - tb;
  return flagMagnitude(b) - flagMagnitude(a);
}

function factionSection(rs: JobResult[], flags: Flag[]): FactionSection | undefined {
  if (!rs.length) return undefined;
  const facs = FACTION_IDS.filter((f) => rs.some((r) => r.tags.factions.includes(f)));
  const t = new Map<string, Tally>();
  const tally = (key: string): Tally => {
    let x = t.get(key);
    if (!x) t.set(key, (x = new Tally()));
    return x;
  };
  const side0 = new Tally();
  const edge = new Tally();
  let timeouts = 0;
  let draws = 0;
  let time = 0;
  const conds = new Set<number>();
  for (const r of rs) {
    const c = CONDITIONS[r.tags.cond]!;
    conds.add(c.index);
    side0.add(score0(r));
    tally(`sun:${r.tags.sun}`).add(score0(r));
    if (r.reason === 'timeout' || r.reason === 'aborted') timeouts++;
    if (r.winner === -1) draws++;
    time += r.time;
    for (const side of [0, 1] as const) {
      const me = r.tags.factions[side];
      const them = r.tags.factions[1 - side]!;
      const s = scoreOf(r, side);
      tally(`pair:${me}~${them}`).add(s);
      tally(`field:${me}`).add(s);
      tally(`cond:${me}:${c.index}`).add(s);
      tally(`light:${me}~${them}:${c.light}`).add(s);
      tally(`wind:${me}~${them}:${c.wind}`).add(s);
    }
    const col = r.tags.colossus;
    if (col && col[0] !== col[1]) edge.add(scoreOf(r, col[0] ? 0 : 1));
  }
  const get = (key: string): Rate => t.get(key)?.rate ?? rate(0, 0);
  const matrix: FactionSection['matrix'] = {};
  const vsField: FactionSection['vsField'] = {};
  const byCondition: FactionSection['byCondition'] = {};
  const pairByLight: Record<string, Rate[]> = {};
  const pairByWind: Record<string, Rate[]> = {};
  const best: FactionSection['best'] = {};
  const worst: FactionSection['worst'] = {};
  for (const a of facs) {
    matrix[a] = {};
    for (const b of facs) if (a !== b && t.has(`pair:${a}~${b}`)) matrix[a]![b] = get(`pair:${a}~${b}`);
    vsField[a] = get(`field:${a}`);
    byCondition[a] = CONDITIONS.map((c) => get(`cond:${a}:${c.index}`));
    const ran = byCondition[a]!.map((r, i) => ({ cond: i, rate: r })).filter((x) => x.rate.n > 0);
    if (ran.length) {
      best[a] = ran.reduce((m, x) => (x.rate.rate > m.rate.rate ? x : m));
      worst[a] = ran.reduce((m, x) => (x.rate.rate < m.rate.rate ? x : m));
    }
    for (const b of facs) {
      if (a === b || !t.has(`pair:${a}~${b}`)) continue;
      pairByLight[`${a}~${b}`] = [0, 1, 2, 3, 4].map((l) => get(`light:${a}~${b}:${l}`));
      pairByWind[`${a}~${b}`] = [0, 1, 2].map((w) => get(`wind:${a}~${b}:${w}`));
    }
  }
  // Target 1: every pairing (once, from the first faction's side) and every faction against the field.
  const T1 = TARGETS.factionAvg;
  for (let i = 0; i < facs.length; i++) {
    for (let j = i + 1; j < facs.length; j++) {
      const a = facs[i]!;
      const b = facs[j]!;
      const r = matrix[a]?.[b];
      if (!r) continue;
      const sev = bandSeverity(r.rate, r.lo, r.hi, T1.min, T1.max);
      if (sev !== 'ok') {
        const [win, lose, wr] = r.rate >= 0.5 ? [a, b, r] : [b, a, flip(r)];
        flags.push({ target: 1, severity: sev, subject: `${win} vs ${lose}`, value: wr.rate, lo: wr.lo, hi: wr.hi, message: `${cap(win)} win ${pctCI(wr)} against ${cap(lose)} over all conditions (target 45–55%).` });
      }
    }
  }
  for (const a of facs) {
    const r = vsField[a]!;
    const sev = bandSeverity(r.rate, r.lo, r.hi, T1.min, T1.max);
    if (sev !== 'ok') flags.push({ target: 1, severity: sev, subject: `${a} vs field`, value: r.rate, lo: r.lo, hi: r.hi, message: `${cap(a)} win ${pctCI(r)} against all other factions (target 45–55%).` });
  }
  // Target 2: each faction against the field per condition, and each pairing per light level and per wind.
  const T2 = TARGETS.factionCond;
  let judgedCells = 0;
  let thinCells = 0;
  const judge = (r: Rate): boolean => {
    if (!r.n) return false;
    if (r.n < TARGETS.minCell) {
      thinCells++;
      return false;
    }
    judgedCells++;
    return true;
  };
  for (const a of facs) {
    for (const [i, r] of byCondition[a]!.entries()) {
      if (!judge(r)) continue;
      const sev = bandSeverity(r.rate, r.lo, r.hi, T2.min, T2.max);
      if (sev !== 'ok') flags.push({ target: 2, severity: sev, subject: `${a} in ${CONDITIONS[i]!.label}`, value: r.rate, lo: r.lo, hi: r.hi, message: `${cap(a)} win ${pctCI(r)} against the field in ${CONDITIONS[i]!.label} (target 40–60%).` });
    }
  }
  for (let i = 0; i < facs.length; i++) {
    for (let j = i + 1; j < facs.length; j++) {
      const a = facs[i]!;
      const b = facs[j]!;
      const light = pairByLight[`${a}~${b}`];
      const wind = pairByWind[`${a}~${b}`];
      const cells: [string, Rate][] = [
        ...(light ?? []).map((r, l): [string, Rate] => [`${LIGHT_NAMES[l]} light`, r]),
        ...(wind ?? []).map((r, w): [string, Rate] => [WIND_NAMES[w]!, r]),
      ];
      for (const [label, r] of cells) {
        if (!judge(r)) continue;
        const sev = bandSeverity(r.rate, r.lo, r.hi, T2.min, T2.max);
        if (sev === 'ok') continue;
        const [win, lose, wr] = r.rate >= 0.5 ? [a, b, r] : [b, a, flip(r)];
        flags.push({ target: 2, severity: sev, subject: `${win} vs ${lose} in ${label}`, value: wr.rate, lo: wr.lo, hi: wr.hi, message: `${cap(win)} win ${pctCI(wr)} against ${cap(lose)} in ${label} (target 40–60%).` });
      }
    }
  }
  const sunKeys = ['N', 'E', 'S', 'W'];
  const side0BySun: Record<string, Rate> = {};
  for (const k of sunKeys) if (t.has(`sun:${k}`)) side0BySun[k] = get(`sun:${k}`);
  const s0 = side0.rate;
  if (bandSeverity(s0.rate, s0.lo, s0.hi, 0.45, 0.55) === 'fail') {
    flags.push({ target: 'sim', severity: 'warn', subject: 'side bias', value: s0.rate, lo: s0.lo, hi: s0.hi, message: `The army deployed at the bottom edge (side 0) wins ${pctCI(s0)} of faction battles; fixtures are side-swapped, so this is map or AI asymmetry, not faction balance.` });
  }
  if (timeouts / rs.length > 0.2) {
    flags.push({ target: 'sim', severity: 'warn', subject: 'faction timeouts', value: timeouts / rs.length, message: `${pct(timeouts / rs.length)} of faction battles hit the time limit and were decided on remaining value.` });
  }
  return {
    factions: facs,
    battles: rs.length,
    conditions: [...conds].sort((a, b) => a - b),
    matrix,
    vsField,
    byCondition,
    pairByLight,
    pairByWind,
    best,
    worst,
    side0: s0,
    side0BySun,
    colossusEdge: edge.rate,
    judgedCells,
    thinCells,
    timeouts,
    draws,
    meanTime: time / rs.length,
  };
}

interface DuelRec {
  enemy: string;
  score: number;
  gained: number;
  paid: number;
  cost: number;
}

function duelSection(rs: JobResult[], flags: Flag[]): DuelSection | undefined {
  if (!rs.length) return undefined;
  const recs = new Map<string, DuelRec[]>();
  const pairT = new Map<string, Tally>();
  const roleT = new Map<string, Tally>();
  let timeouts = 0;
  let stalls = 0;
  let forced = 0;
  for (const r of rs) {
    if (r.reason === 'timeout' || r.reason === 'aborted') {
      timeouts++;
      if (r.sides[0].lost < 0.05 && r.sides[1].lost < 0.05) stalls++;
    }
    if ((r.forced ?? 0) > 0) forced++;
    for (const side of [0, 1] as const) {
      const me = r.tags.subjects[side];
      const them = r.tags.subjects[1 - side]!;
      const s = scoreOf(r, side);
      const mine = r.sides[side];
      const theirs = r.sides[1 - side]!;
      if (!recs.has(me)) recs.set(me, []);
      recs.get(me)!.push({ enemy: them, score: s, gained: theirs.lost * theirs.cost, paid: mine.lost * mine.cost, cost: mine.cost });
      const pk = `${me}>${them}`;
      if (!pairT.has(pk)) pairT.set(pk, new Tally());
      pairT.get(pk)!.add(s);
      if (hasUnit(me) && hasUnit(them)) {
        const rk = `${unitDef(me).role}>${unitDef(them).role}`;
        if (!roleT.has(rk)) roleT.set(rk, new Tally());
        roleT.get(rk)!.add(s);
      }
    }
  }
  // Per-unit exchange and win rate.
  const units: DuelUnitRow[] = [];
  for (const [id, list] of recs) {
    if (!hasUnit(id)) continue;
    const def = unitDef(id);
    const w = new Tally();
    for (const x of list) w.add(x.score);
    const gained = list.map((x) => x.gained);
    const paid = list.map((x) => x.paid);
    const eps = 0.01 * list.reduce((a, x) => a + x.cost, 0);
    const exchange = (sum(gained) + eps) / (sum(paid) + eps);
    const [lo, hi] = ratioInterval(gained, paid, eps, id);
    units.push({ id, name: def.name, faction: def.faction, role: def.role, cost: def.cost, duels: list.length, winRate: w.rate, exchange, exchangeLo: lo, exchangeHi: hi, roleMedian: NaN, deviation: 0, devLo: 0, devHi: 0 });
  }
  const roleList = [...new Set(units.map((u) => u.role))];
  const roles: DuelSection['roles'] = [];
  for (const role of roleList) {
    const inRole = units.filter((u) => u.role === role);
    const med = median(inRole.map((u) => u.exchange));
    roles.push({ role, median: med, units: inRole.length });
    for (const u of inRole) {
      u.roleMedian = med;
      u.deviation = u.exchange / med - 1;
      u.devLo = u.exchangeLo / med - 1;
      u.devHi = u.exchangeHi / med - 1;
      if (inRole.length < 2) continue;
      const e = TARGETS.efficiency;
      const sev = bandSeverity(u.deviation, u.devLo, u.devHi, -e, e);
      if (sev === 'ok') continue;
      u.severity = role === 'support' ? 'info' : sev;
      flags.push({
        target: 3,
        severity: u.severity,
        subject: u.id,
        value: u.deviation,
        lo: u.devLo,
        hi: u.devHi,
        message: `${u.name} (${role}) trades ${u.exchange.toFixed(2)} enemy points per point lost, ${signedPct(u.deviation)} from the ${role} median ${med.toFixed(2)} (95%: ${signedPct(u.devLo)} to ${signedPct(u.devHi)}; target ±10%)${role === 'support' ? '; support units are valued for their auras, which duels do not measure' : ''}.`,
      });
    }
  }
  units.sort((a, b) => (a.role === b.role ? b.deviation - a.deviation : a.role.localeCompare(b.role)));
  const roleGrid: DuelSection['roleGrid'] = {};
  for (const [k, v] of roleT) {
    const [a, b] = k.split('>') as [Role, Role];
    (roleGrid[a] ??= {})[b] = v.rate;
  }
  const counterTable: DuelSection['counterTable'] = [];
  for (const [role, list] of Object.entries(DOC_COUNTERS) as [Role, Role[]][]) {
    for (const beats of list) {
      const x = roleGrid[role]?.[beats];
      if (!x || !x.n) continue;
      // Holds unless the duels clearly say otherwise (a coin flip or worse).
      const holds = x.rate > 0.5;
      counterTable.push({ role, beats, rate: x, holds });
      if (!holds) {
        flags.push({
          target: 'roles',
          severity: 'info',
          subject: `${role}>${beats}`,
          value: x.rate,
          lo: x.lo,
          hi: x.hi,
          message: `The doc's counters table has ${role} beating ${beats}, but ${role} units won ${pctCI(x)} of equal-cost duels against ${beats} units.`,
        });
      }
    }
  }
  const pairs: Record<string, Record<string, [number, number]>> = {};
  for (const [k, v] of pairT) {
    const [a, b] = k.split('>') as [string, string];
    (pairs[a] ??= {})[b] = [Math.round(v.rate.rate * 1000) / 1000, v.n];
  }
  // Counters: cheaper-or-equal enemy units that win at least 60% of duels.
  const counters: CounterRow[] = [];
  const facs = FACTION_IDS.filter((f) => units.some((u) => u.faction === f));
  for (const u of units) {
    const row: CounterRow = { id: u.id, name: u.name, faction: u.faction, cost: u.cost, byFaction: {} };
    for (const f of facs) {
      if (f === u.faction) continue;
      const cands = duelUnits(f).filter((v) => v.cost <= u.cost && pairs[v.id]?.[u.id]);
      const found = cands
        .map((v) => ({ id: v.id, name: v.name, cost: v.cost, rate: pairs[v.id]![u.id]![0] }))
        .filter((x) => x.rate >= TARGETS.counterRate)
        .sort((a, b) => b.rate - a.rate);
      const status: CounterCell['status'] = found.length >= TARGETS.counters ? 'pass' : cands.length < TARGETS.counters ? 'impossible' : 'fail';
      row.byFaction[f] = { counters: found, candidates: cands.length, status };
      if (status === 'pass') continue;
      flags.push({
        target: 4,
        severity: status === 'impossible' ? 'info' : 'fail',
        subject: `${u.id} vs ${f}`,
        value: found.length,
        message:
          status === 'impossible'
            ? `${u.name} (${u.cost}) can't have 2 counters in ${cap(f)}: only ${cands.length} ${cap(f)} unit${cands.length === 1 ? '' : 's'} cost${cands.length === 1 ? 's' : ''} ${u.cost} or less.`
            : `${u.name} (${u.cost}) has ${found.length} counter${found.length === 1 ? '' : 's'} in ${cap(f)} (${found.map((x) => `${x.name} ${pct(x.rate)}`).join(', ') || 'none'}); ${cands.length} ${cap(f)} units cost no more.`,
      });
    }
    counters.push(row);
  }
  if (stalls > 0) {
    flags.push({ target: 'sim', severity: 'info', subject: 'stalled duels', value: stalls, message: `${stalls} duel${stalls === 1 ? '' : 's'} ended on the timer with neither side 5% down; their result is a coin flip on remaining value.` });
  }
  return { battles: rs.length, timeouts, stalls, forcedShare: forced / rs.length, units, roles: roles.sort((a, b) => a.role.localeCompare(b.role)), roleGrid, counterTable, counters, pairs };
}

function colossusSection(rs: JobResult[], flags: Flag[]): ColossusSection | undefined {
  if (!rs.length) return undefined;
  const rows = new Map<string, { all: Tally; fac: Map<FactionId, Tally>; light: Tally[]; time: number; timeouts: number; arms: number; lost: number; armsLost: number; n: number }>();
  for (const r of rs) {
    const cs = r.tags.subjects[0].startsWith('arms:') ? 1 : 0;
    const id = r.tags.subjects[cs];
    const enemy = r.tags.factions[1 - cs]!;
    let row = rows.get(id);
    if (!row) {
      row = { all: new Tally(), fac: new Map(), light: [0, 1, 2, 3, 4].map(() => new Tally()), time: 0, timeouts: 0, arms: 0, lost: 0, armsLost: 0, n: 0 };
      rows.set(id, row);
    }
    const s = scoreOf(r, cs);
    row.all.add(s);
    if (!row.fac.has(enemy)) row.fac.set(enemy, new Tally());
    row.fac.get(enemy)!.add(s);
    row.light[CONDITIONS[r.tags.cond]!.light]!.add(s);
    row.time += r.time;
    if (r.reason === 'timeout' || r.reason === 'aborted') row.timeouts++;
    row.arms += r.tags.costs[1 - cs]!;
    row.lost += r.sides[cs].lost;
    row.armsLost += r.sides[1 - cs]!.lost;
    row.n++;
  }
  const out: ColossusRow[] = [];
  for (const [id, x] of rows) {
    const def = unitDef(id);
    const byFaction: ColossusRow['byFaction'] = {};
    for (const [f, t] of x.fac) byFaction[f] = t.rate;
    const row: ColossusRow = {
      id,
      name: def.name,
      faction: def.faction,
      vsArms: x.all.rate,
      byFaction,
      byLight: x.light.map((t) => t.rate),
      meanTime: x.time / x.n,
      timeouts: x.timeouts,
      meanArmsCost: x.arms / x.n,
      meanLost: x.lost / x.n,
      meanArmsLost: x.armsLost / x.n,
    };
    const T5 = TARGETS.colossus;
    const r = row.vsArms;
    const sev = bandSeverity(r.rate, r.lo, r.hi, T5.min, T5.max);
    if (sev !== 'ok') {
      row.severity = sev;
      flags.push({ target: 5, severity: sev, subject: id, value: r.rate, lo: r.lo, hi: r.hi, message: `${def.name} wins ${pctCI(r)} alone against ${Math.round(row.meanArmsCost)} points of combined arms (target 40–50%).` });
    }
    out.push(row);
  }
  out.sort((a, b) => FACTION_IDS.indexOf(a.faction) - FACTION_IDS.indexOf(b.faction));
  return { battles: rs.length, rows: out };
}

function healthSection(results: readonly JobResult[], flags: Flag[]): HealthSection {
  const bySuite: HealthSection['bySuite'] = {};
  for (const s of ['factions', 'duels', 'colossus'] as SuiteId[]) {
    const rs = results.filter((r) => r.suite === s);
    if (!rs.length) continue;
    bySuite[s] = {
      jobs: rs.length,
      timeouts: rs.filter((r) => r.reason === 'timeout' || r.reason === 'aborted').length,
      meanTime: sum(rs.map((r) => r.time)) / rs.length,
      meanCpuMs: sum(rs.map((r) => r.cpuMs)) / rs.length,
    };
  }
  const holdouts = new Map<string, number>();
  for (const r of results) {
    if (r.suite !== 'factions' || !r.standing) continue;
    // The side that was behind on value is the one dragging the battle out.
    const behind = r.sides[0].removed > r.sides[1].removed ? 0 : 1;
    for (const id of new Set(r.standing[behind])) holdouts.set(id, (holdouts.get(id) ?? 0) + 1);
  }
  const timeoutHoldouts = [...holdouts]
    .map(([id, count]) => ({ id, name: hasUnit(id) ? unitDef(id).name : id, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);
  const errors = results.filter((r) => r.reason === 'error').map((r) => ({ id: r.id, error: r.error ?? 'unknown' }));
  const nans = results.filter((r) => r.nanAt !== undefined).map((r) => ({ id: r.id, at: r.nanAt!, what: r.error ?? '' }));
  const aborted = results.filter((r) => r.reason === 'aborted').map((r) => r.id);
  for (const e of errors.slice(0, 20)) flags.push({ target: 'sim', severity: 'fail', subject: e.id, message: `The simulation threw: ${e.error.split('\n')[0]}` });
  if (errors.length > 20) flags.push({ target: 'sim', severity: 'fail', subject: 'errors', message: `${errors.length - 20} more battles threw.` });
  for (const n of nans.slice(0, 20)) flags.push({ target: 'sim', severity: 'fail', subject: n.id, message: `${n.what} at ${n.at.toFixed(0)} s.` });
  if (aborted.length) flags.push({ target: 'sim', severity: 'warn', subject: 'slow battles', value: aborted.length, message: `${aborted.length} battle${aborted.length === 1 ? '' : 's'} ran past the wall-clock limit and were scored as they stood.` });
  return { jobs: results.length, bySuite, timeoutHoldouts, errors, nans, aborted };
}

function targetStatus(flags: Flag[], s: { factions?: FactionSection; duels?: DuelSection; colossus?: ColossusSection }): TargetStatus[] {
  const out: TargetStatus[] = [];
  const ran: Record<TargetId, boolean> = { 1: !!s.factions, 2: !!s.factions, 3: !!s.duels, 4: !!s.duels, 5: !!s.colossus };
  for (const id of [1, 2, 3, 4, 5] as TargetId[]) {
    const mine = flags.filter((f) => f.target === id);
    const fail = mine.filter((f) => f.severity === 'fail').length;
    const warn = mine.filter((f) => f.severity === 'warn').length;
    const info = mine.filter((f) => f.severity === 'info').length;
    let status: TargetStatus['status'] = !ran[id] ? 'not run' : fail ? 'fail' : warn ? 'warn' : 'pass';
    let summary = !ran[id] ? 'Suite not run.' : fail + warn === 0 ? 'All within target.' : `${fail} clear miss${fail === 1 ? '' : 'es'}, ${warn} possible (within noise).`;
    if (ran[id] && info) summary += ` ${info} note${info === 1 ? '' : 's'}.`;
    if (id === 2 && s.factions) {
      if (!s.factions.judgedCells) {
        status = 'thin';
        summary = `Too few battles in any condition to judge (a cell needs ${TARGETS.minCell}); add fixtures or pick fewer conditions per light.`;
      } else if (s.factions.thinCells) summary += ` ${s.factions.thinCells} cell${s.factions.thinCells === 1 ? '' : 's'} with under ${TARGETS.minCell} battles not judged.`;
    }
    if (id === 1 && s.factions) summary = `${summary} Vs field: ${s.factions.factions.map((f) => `${cap(f)} ${pct(s.factions!.vsField[f]!.rate)}`).join(', ')}.`;
    if (id === 5 && s.colossus) summary = `${summary} ${s.colossus.rows.map((r) => `${r.name} ${pct(r.vsArms.rate)}`).join(', ')}.`;
    out.push({ id, ...TARGET_TEXT[id], status, summary });
  }
  return out;
}

// ---------------------------------------------------------------- markdown

export function reportMarkdown(r: BalanceReport): string {
  const L: string[] = [];
  const m = r.meta;
  L.push('# Nailed Sun balance report', '');
  L.push(`Generated ${m.generated}${m.commit ? ` at commit \`${m.commit}\`` : ''}.${m.command ? ` Command: \`${m.command}\`.` : ''}`, '');
  const settings = Object.entries(m.settings)
    .map(([k, v]) => `${k} ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    .join('; ');
  L.push(`Settings: ${settings}.`, '');
  if (m.timing) {
    const parts = Object.entries(m.timing).map(([s, t]) => `${s}: ${t!.jobs} battles in ${fmtDuration(t!.wallMs)} (mean ${(t!.cpuMs / Math.max(1, t!.jobs) / 1000).toFixed(1)} s CPU each)`);
    L.push(`Runtime: ${parts.join('; ')}${m.machine ? ` on ${m.machine}` : ''}.`, '');
  }

  L.push('## Targets', '');
  L.push('| # | Target | Goal | Status | Summary |', '|---|---|---|---|---|');
  for (const t of r.targets) L.push(`| ${t.id} | ${t.name} | ${t.goal} | **${t.status.toUpperCase()}** | ${t.summary} |`);
  L.push('', 'FAIL means the whole 95% interval misses the target; WARN means the estimate misses but the interval still overlaps it (more seeds would tell).', '');

  const main = r.flags.filter((f) => f.target !== 'formula');
  L.push('## Flags', '');
  if (!main.length) L.push('No flags.', '');
  else {
    L.push('Worst first within each target; clear misses (FAIL) before possible ones (WARN). Every flag is in the JSON report.', '');
    const groups: ('sim' | TargetId)[] = ['sim', 1, 2, 3, 4, 5];
    const cap = 10;
    for (const g of groups) {
      const list = main.filter((f) => f.target === g && f.severity !== 'info');
      if (!list.length) continue;
      L.push(`**${g === 'sim' ? 'Simulation' : `Target ${g}: ${TARGET_TEXT[g].name}`}** (${list.filter((f) => f.severity === 'fail').length} fail, ${list.filter((f) => f.severity === 'warn').length} warn)`, '');
      for (const f of list.slice(0, cap)) L.push(`- **${f.severity.toUpperCase()}** ${f.message}`);
      if (list.length > cap) L.push(`- …and ${list.length - cap} more.`);
      L.push('');
    }
    const notes = main.filter((f) => f.severity === 'info');
    if (notes.length) {
      L.push(`**Notes** (${notes.length})`, '');
      for (const f of notes.slice(0, 30)) L.push(`- [${targetLabel(f.target)}] ${f.message}`);
      if (notes.length > 30) L.push(`- …and ${notes.length - 30} more.`);
      L.push('');
    }
  }

  if (r.factions) factionMarkdown(r.factions, L);
  if (r.colossus) colossusMarkdown(r.colossus, L);
  if (r.duels) duelMarkdown(r.duels, L);
  formulaMarkdown(r, L);
  healthMarkdown(r, L);
  methodMarkdown(L);
  return L.join('\n');
}

function factionMarkdown(f: FactionSection, L: string[]): void {
  L.push('## 1. Faction vs faction (equal cost)', '');
  L.push(`${f.battles} battles over ${f.conditions.length} condition${f.conditions.length === 1 ? '' : 's'}; ${f.timeouts} ended on the timer, ${f.draws} drawn; mean length ${f.meanTime.toFixed(0)} s.`, '');
  L.push('Win rate of the row faction against the column faction (% wins, 95% interval, battles):', '');
  L.push(`| | ${f.factions.map(cap).join(' | ')} | vs field |`, `|---|${f.factions.map(() => '---').join('|')}|---|`);
  for (const a of f.factions) {
    const cells = f.factions.map((b) => (a === b ? '—' : f.matrix[a]?.[b] ? rateCell(f.matrix[a]![b]!) : ''));
    L.push(`| **${cap(a)}** | ${cells.join(' | ')} | ${rateCell(f.vsField[a]!)} |`);
  }
  L.push('');
  L.push(
    `Side 0 (bottom edge) wins ${pctCI(f.side0)}` +
      (Object.keys(f.side0BySun).length ? `; by sun bearing: ${Object.entries(f.side0BySun).map(([k, v]) => `${k} ${pct(v.rate)} (n=${v.n})`).join(', ')}` : '') +
      '. With the sun in the north, side 0 faces it.',
    '',
  );
  if (f.colossusEdge.n) L.push(`Armies that rolled their colossus against one that didn't won ${pctCI(f.colossusEdge)}.`, '');

  L.push('### 2. Conditions', '');
  L.push('Best and worst condition against the field:', '');
  L.push('| Faction | Worst | Best |', '|---|---|---|');
  for (const a of f.factions) {
    const w = f.worst[a];
    const b = f.best[a];
    L.push(`| ${cap(a)} | ${w ? `${CONDITIONS[w.cond]!.label}: ${rateCell(w.rate)}` : '—'} | ${b ? `${CONDITIONS[b.cond]!.label}: ${rateCell(b.rate)}` : '—'} |`);
  }
  L.push('');
  L.push('Win rate against the field in each condition (% wins, battles):', '');
  L.push(`| Faction | Light | ${WIND_NAMES.join(' | ')} |`, '|---|---|---|---|---|');
  for (const a of f.factions) {
    let first = true;
    for (let l = 0; l < 5; l++) {
      const cells = [0, 1, 2].map((w) => {
        const r = f.byCondition[a]![l * 3 + w]!;
        return r.n ? `${pct(r.rate)} (${r.n})` : '—';
      });
      if (cells.every((c) => c === '—')) continue;
      L.push(`| ${first ? `**${cap(a)}**` : ''} | ${LIGHT_NAMES[l]} | ${cells.join(' | ')} |`);
      first = false;
    }
  }
  L.push('');
  const pairs = Object.keys(f.pairByLight).filter((k) => {
    const [a, b] = k.split('~');
    return f.factions.indexOf(a as FactionId) < f.factions.indexOf(b as FactionId);
  });
  if (pairs.length) {
    L.push('Each pairing by light level and by wind (win rate of the first faction, battles):', '');
    L.push(`| Pairing | ${LIGHT_NAMES.join(' | ')} | ${WIND_NAMES.join(' | ')} |`, `|---|${LIGHT_NAMES.map(() => '---').join('|')}|${WIND_NAMES.map(() => '---').join('|')}|`);
    for (const k of pairs) {
      const [a, b] = k.split('~') as [FactionId, FactionId];
      const cells = [...f.pairByLight[k]!, ...f.pairByWind[k]!].map((r) => (r.n ? `${pct(r.rate)} (${r.n})` : '—'));
      L.push(`| ${cap(a)} vs ${cap(b)} | ${cells.join(' | ')} |`);
    }
    L.push('');
  }
}

function colossusMarkdown(c: ColossusSection, L: string[]): void {
  L.push('## 5. Colossus vs equal-cost combined arms', '');
  L.push(`${c.battles} battles: each colossus alone against about 3,200 points of an enemy faction's line, missiles and cavalry (no lord, heroes or colossus).`, '');
  const facs = FACTION_IDS;
  L.push(`| Colossus | Wins | ${facs.map(cap).join(' | ')} | ${LIGHT_NAMES.join(' | ')} | Arms cost | Mean length | Timeouts | Colossus HP lost | Arms value lost |`);
  L.push(`|---|---|${facs.map(() => '---').join('|')}|${LIGHT_NAMES.map(() => '---').join('|')}|---|---|---|---|---|`);
  for (const r of c.rows) {
    const byF = facs.map((f) => (r.byFaction[f] ? `${pct(r.byFaction[f]!.rate)}` : '—'));
    const byL = r.byLight.map((x) => (x.n ? pct(x.rate) : '—'));
    L.push(`| ${r.name} | ${rateCell(r.vsArms)} | ${byF.join(' | ')} | ${byL.join(' | ')} | ${Math.round(r.meanArmsCost)} | ${r.meanTime.toFixed(0)} s | ${r.timeouts} | ${pct(r.meanLost)} | ${pct(r.meanArmsLost)} |`);
  }
  L.push('', 'Battles on the timer are scored by the simulation’s remaining-value rule, which counts a colossus at full value until it falls.', '');
}

function duelMarkdown(d: DuelSection, L: string[]): void {
  L.push('## 3. Cost efficiency in role (unit duels)', '');
  L.push(
    `${d.battles} duels at equal cost (the cheaper unit fielded in copies to within 10%), Dusk light and a Breeze on open ground; ${d.timeouts} ended on the timer (${d.stalls} without a real fight), and in ${pct(d.forcedShare)} the duel harness had to send an idle unit in. Efficiency is enemy points destroyed per own point lost (wounds count), summed over every duel against every enemy-faction unit; the interval is a bootstrap over duels.`,
    '',
  );
  L.push('| Unit | Faction | Role | Cost | Duel wins | Efficiency | Role median | vs median (95%) | Flag |', '|---|---|---|---|---|---|---|---|---|');
  for (const u of d.units) {
    L.push(
      `| ${u.name} | ${cap(u.faction)} | ${u.role} | ${u.cost} | ${pct(u.winRate.rate)} (${u.winRate.n}) | ${u.exchange.toFixed(2)} | ${u.roleMedian.toFixed(2)} | ${signedPct(u.deviation)} (${signedPct(u.devLo)} to ${signedPct(u.devHi)}) | ${u.severity ? `**${u.severity.toUpperCase()}**` : ''} |`,
    );
  }
  L.push('');
  const roles = [...new Set(d.units.map((u) => u.role))];
  L.push('### Role against role', '', 'Win rate of row-role units against column-role units at equal cost (% wins, duels):', '');
  L.push(`| | ${roles.join(' | ')} |`, `|---|${roles.map(() => '---').join('|')}|`);
  for (const a of roles) {
    const cells = roles.map((b) => {
      const x = d.roleGrid[a]?.[b];
      return x && x.n ? `${pct(x.rate)} (${x.n})` : '—';
    });
    L.push(`| **${a}** | ${cells.join(' | ')} |`);
  }
  L.push('');
  if (d.counterTable.length) {
    const broken = d.counterTable.filter((c) => !c.holds);
    L.push(
      `The doc's counters table, checked against these duels: ${d.counterTable.length - broken.length} of ${d.counterTable.length} relations hold (the counter wins more than half).` +
        (broken.length ? ` Contradicted: ${broken.map((c) => `${c.role} over ${c.beats} (${pct(c.rate.rate)}, n=${c.rate.n})`).join('; ')}.` : ''),
      '',
    );
  }
  L.push('## 4. Counters', '');
  L.push('A counter is an enemy unit that costs no more and wins at least 60% of the duels. Each cell lists the counters found (win %), or why the target cannot be met.', '');
  const facs = FACTION_IDS.filter((f) => d.counters.some((c) => c.faction === f));
  L.push(`| Unit | Cost | ${facs.map(cap).join(' | ')} |`, `|---|---|${facs.map(() => '---').join('|')}|`);
  for (const c of d.counters) {
    const cells = facs.map((f) => {
      if (f === c.faction) return '—';
      const x = c.byFaction[f];
      if (!x) return '';
      const names = x.counters.map((k) => `${k.name} ${pct(k.rate)}`).join(', ');
      const mark = x.status === 'pass' ? '✓' : x.status === 'impossible' ? `n/a (${x.candidates} cheaper)` : '✗';
      return `${mark} ${names}`.trim();
    });
    L.push(`| ${c.name} | ${c.cost} | ${cells.join(' | ')} |`);
  }
  L.push('');
}

function formulaMarkdown(r: BalanceReport, L: string[]): void {
  L.push('## 6. Cost formula', '');
  L.push(
    'Cost = k · sqrt(EHP · EDPS) · s + a, from stats alone. EHP is total HP over exposure to a reference line soldier (75%) and arrow (25%) after MD, armor and shields; EDPS is expected damage per second of the whole unit against a reference line/cavalry mix (front two ranks in contact, one charge per 20 s, missiles over a 150 s fight with a range factor); s = (speed / 5)^0.3; a = heuristic points for mechanics, abilities and passives. k is fitted per role family (median), so the deviation compares a unit with others of its kind. Definitions are in `src/balance/formula.ts`.',
    '',
  );
  L.push(`k by family: ${Object.entries(r.formula.k).map(([f, k]) => `${f} ${k!.toFixed(2)}`).join(', ')}.`, '');
  L.push('| Unit | Family | Cost | Formula | Actual vs formula | EHP | EDPS | s | a |', '|---|---|---|---|---|---|---|---|---|');
  const rows = [...r.formula.rows].sort((a, b) => (a.family === b.family ? b.deviation - a.deviation : a.family.localeCompare(b.family)));
  for (const x of rows) L.push(`| ${x.name} | ${x.family} | ${x.cost} | ${x.formula} | ${signedPct(x.deviation)} | ${x.ehp} | ${x.edps.toFixed(1)} | ${x.s.toFixed(2)} | ${x.a} |`);
  L.push('');
}

function healthMarkdown(r: BalanceReport, L: string[]): void {
  const h = r.health;
  L.push('## Simulation health', '');
  L.push(`${h.jobs} battles run; ${h.errors.length} threw, ${h.nans.length} produced NaNs, ${h.aborted.length} hit the wall-clock limit.`, '');
  const rows = Object.entries(h.bySuite);
  if (rows.length) {
    L.push('| Suite | Battles | Timeouts | Mean simulated length | Mean CPU per battle |', '|---|---|---|---|---|');
    for (const [s, x] of rows) L.push(`| ${s} | ${x!.jobs} | ${x!.timeouts} | ${x!.meanTime.toFixed(0)} s | ${(x!.meanCpuMs / 1000).toFixed(2)} s |`);
    L.push('');
  }
  if (h.timeoutHoldouts.length) {
    const fs = h.bySuite.factions;
    L.push(
      `Faction battles that hit the time limit${fs ? ` (${fs.timeouts} of ${fs.jobs})` : ''}: units most often still fighting on the side that was behind — ${h.timeoutHoldouts.map((x) => `${x.name} ${x.count}`).join(', ')}.`,
      '',
    );
  }
  for (const e of h.errors.slice(0, 10)) L.push(`- \`${e.id}\`: ${e.error.split('\n')[0]}`);
  for (const n of h.nans.slice(0, 10)) L.push(`- \`${n.id}\`: ${n.what} at ${n.at.toFixed(0)} s`);
  if (h.errors.length || h.nans.length) L.push('');
}

function methodMarkdown(L: string[]): void {
  L.push('## Method', '');
  L.push(
    '- Both sides are played by the same scripted battle AI (`src/ai/battleAI.ts`). Every fixture is fought twice with the sides swapped, and the sun is rotated north, east, south and west across fixtures, so deployment edge and glare cancel out.',
    '- Conditions: 5 light levels (Dark to Blaze) × 3 winds (Calm, Breeze, Gale), each fought on the terrain of the band that has that light naturally (Evernight, Dimmark, Gloaming, Long Afternoon, Glare).',
    '- Faction battles: two armies of the same budget from the army generator (`generateArmy`, colossus “maybe”), one random draw per fixture, auto-deployed; decided by rout, or on remaining value at the time limit.',
    '- Unit duels: cost-matched copies placed 300 m apart on open, flat ground checked free of water, woods and rocks. A lone unit gives the battle AI no battle line, so the duel harness (`src/balance/duelAI.ts`) sends idle units at the nearest enemy after 20 s without damage or closing in; both sides use it. Duels leave out army context: no general, no Toll, no auras from other units.',
    '- Unit size: with `unitScale` below 1 only infantry, cavalry, beasts and flyers shrink; monsters, artillery, heroes and colossi keep full strength, so reduced-scale runs favour armies that field more of them.',
    '- Win rates count a draw as half a win. Intervals are 95% Wilson intervals for win rates and bootstrap intervals for efficiency.',
    '',
  );
}

// ----------------------------------------------------------------- helpers

function flip(r: Rate): Rate {
  return { n: r.n, score: r.n - r.score, rate: 1 - r.rate, lo: 1 - r.hi, hi: 1 - r.lo };
}

function sum(xs: readonly number[]): number {
  let s = 0;
  for (const x of xs) s += x;
  return s;
}

export function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}

export function signedPct(x: number): string {
  if (!Number.isFinite(x)) return '—';
  const v = Math.round(x * 100);
  return `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v)}%`;
}

export function pctCI(r: Rate): string {
  return `${pct(r.rate)} (95%: ${pct(r.lo)}–${pct(r.hi)}, n=${r.n})`;
}

function rateCell(r: Rate): string {
  return r.n ? `${pct(r.rate)} (${pct(r.lo)}–${pct(r.hi)}, ${r.n})` : '—';
}

export function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function targetLabel(t: Flag['target']): string {
  return typeof t === 'number' ? `target ${t}` : t === 'roles' ? 'counters table' : t;
}

function fmtDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  return s >= 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s} s`;
}
