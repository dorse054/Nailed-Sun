/**
 * Headless balance simulator.
 *
 *   npx tsx tools/balance.ts [--suite all|factions|duels|colossus] [--seeds N]
 *                            [--scale 1] [--workers 4] [--out reports] [--quick]
 *
 * Runs the design doc's automated battles on worker threads and writes
 * <out>/balance-report.md and <out>/balance-report.json. Run with --help for
 * every option.
 */
import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import type { FactionId } from '../src/data/schema';
import { FACTION_IDS } from '../src/data/schema';
import type { Condition } from '../src/balance/conditions';
import { CONDITIONS, parseConditions } from '../src/balance/conditions';
import type { BalanceJob, SuiteId } from '../src/balance/suites';
import { DEFAULTS, colossusVsArms, factionMatchups, unitDuels } from '../src/balance/suites';
import type { JobResult } from '../src/balance/runner';
import { jobWeight, runJob } from '../src/balance/runner';
import type { ReportMeta } from '../src/balance/report';
import { buildReport, pct, reportMarkdown } from '../src/balance/report';

const HELP = `Nailed Sun balance simulator

Usage: npx tsx tools/balance.ts [options]   (or: npm run balance -- [options])

  --suite S          all | factions | duels | colossus, or a comma list (default all)
  --seeds N          fixtures per pairing and condition, for every suite (default 1)
  --faction-seeds N  override --seeds for the faction suite
  --duel-seeds N     override --seeds for unit duels
  --colossus-seeds N override --seeds for colossus vs combined arms
  --scale S          unit size for faction battles (default 1; 0.5 is ~2.5x faster
                     but over-weights monsters, artillery, heroes and colossi,
                     which do not shrink). Duels and colossus runs always use 1.
  --budget N         army budget for faction battles (default ${DEFAULTS.budget})
  --factions LIST    e.g. choir,hush (default all four)
  --conditions SPEC  all | dusk-breeze,dark-calm | light=0,2;wind=1 (default all 15)
  --time-limit S     simulated seconds before a faction battle is scored on
                     remaining value (default ${DEFAULTS.factionTimeLimit})
  --workers N        worker threads (default: cores, at most 4)
  --out DIR          report directory (default reports)
  --salt TEXT        draw a fresh sample (changes every seed)
  --raw              also write every battle result to <out>/balance-raw.tmp.json
  --from FILE        skip the battles: rebuild the report from a --raw file
  --quick            a smoke run of about a minute: 2 conditions, 9,000-point
                     armies at scale 0.5, Choir-vs-Hush duels, colossi in
                     Dusk/Breeze only
  --help             this text
`;

const QUICK_DUEL_LIMIT = 120;

interface Args {
  suites: SuiteId[];
  seeds: { factions: number; duels: number; colossus: number };
  scale: number;
  budget: number;
  factions: FactionId[];
  conditions: Condition[];
  timeLimit: number;
  workers: number;
  out: string;
  salt: string;
  raw: boolean;
  from?: string;
  quick: boolean;
}

function parseArgs(argv: string[]): Args {
  const opts = new Map<string, string>();
  const flags = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith('--')) throw new Error(`Unexpected argument "${a}"`);
    const eq = a.indexOf('=');
    if (eq > 0) opts.set(a.slice(2, eq), a.slice(eq + 1));
    else if (['quick', 'raw', 'help'].includes(a.slice(2))) flags.add(a.slice(2));
    else {
      const v = argv[++i];
      if (v === undefined) throw new Error(`Missing value for ${a}`);
      opts.set(a.slice(2), v);
    }
  }
  if (flags.has('help')) {
    process.stdout.write(HELP);
    process.exit(0);
  }
  const known = ['suite', 'seeds', 'faction-seeds', 'duel-seeds', 'colossus-seeds', 'scale', 'budget', 'factions', 'conditions', 'time-limit', 'workers', 'out', 'salt', 'from'];
  for (const k of opts.keys()) if (!known.includes(k)) throw new Error(`Unknown option --${k} (see --help)`);
  const num = (k: string, d: number): number => {
    const v = opts.get(k);
    if (v === undefined) return d;
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) throw new Error(`--${k} needs a positive number`);
    return n;
  };
  const quick = flags.has('quick');
  const suiteArg = opts.get('suite') ?? 'all';
  const suites: SuiteId[] = suiteArg === 'all' ? ['factions', 'colossus', 'duels'] : (suiteArg.split(',') as SuiteId[]);
  for (const s of suites) if (!['factions', 'duels', 'colossus'].includes(s)) throw new Error(`Unknown suite "${s}"`);
  const factions = (opts.get('factions')?.split(',') ?? [...FACTION_IDS]) as FactionId[];
  for (const f of factions) if (!FACTION_IDS.includes(f)) throw new Error(`Unknown faction "${f}"`);
  const seeds = Math.round(num('seeds', 1));
  const conditions = opts.has('conditions') ? parseConditions(opts.get('conditions')) : quick ? parseConditions('dark-calm,blaze-gale') : [...CONDITIONS];
  return {
    suites,
    seeds: {
      factions: Math.round(num('faction-seeds', seeds)),
      duels: Math.round(num('duel-seeds', seeds)),
      colossus: Math.round(num('colossus-seeds', seeds)),
    },
    scale: num('scale', quick ? 0.5 : 1),
    budget: num('budget', quick ? 9000 : DEFAULTS.budget),
    factions,
    conditions,
    timeLimit: num('time-limit', DEFAULTS.factionTimeLimit),
    workers: Math.max(1, Math.round(num('workers', Math.min(4, cpus().length)))),
    out: opts.get('out') ?? 'reports',
    salt: opts.get('salt') ?? '',
    raw: flags.has('raw'),
    from: opts.get('from'),
    quick,
  };
}

function buildJobs(a: Args, suite: SuiteId): BalanceJob[] {
  const salt = a.salt ? `:${a.salt}` : '';
  switch (suite) {
    case 'factions':
      return factionMatchups({ factions: a.factions, conditions: a.conditions, seeds: a.seeds.factions, budget: a.budget, scale: a.scale, timeLimit: a.timeLimit, salt });
    case 'duels':
      return unitDuels({ factions: a.quick ? a.factions.filter((f) => f === 'choir' || f === 'hush') : a.factions, seeds: a.seeds.duels, salt, timeLimit: a.quick ? QUICK_DUEL_LIMIT : undefined });
    case 'colossus':
      return colossusVsArms({ factions: a.factions, conditions: a.quick ? parseConditions('dusk-breeze') : a.conditions, seeds: a.seeds.colossus, salt });
  }
}

// ------------------------------------------------------------------ worker pool

type ToWorker = { type: 'job'; index: number; job: BalanceJob } | { type: 'stop' };
type FromWorker = { type: 'result'; index: number; result: JobResult };

function spawn(): Worker {
  // tsx's loader does not follow into worker threads, so each worker registers it first.
  const api = import.meta.resolve('tsx/esm/api');
  const self = import.meta.url;
  const code = `import(${JSON.stringify(api)}).then((m) => { m.register(); return import(${JSON.stringify(self)}); });`;
  const young = Number(process.env.BALANCE_YOUNG_MB ?? 0);
  return new Worker(code, { eval: true, ...(young > 0 ? { resourceLimits: { maxYoungGenerationSizeMb: young } } : {}) });
}

async function runPool(jobs: BalanceJob[], workers: number, label: string): Promise<{ results: JobResult[]; wallMs: number }> {
  const order = jobs.map((_, i) => i).sort((x, y) => jobWeight(jobs[y]!) - jobWeight(jobs[x]!) || x - y);
  const results: JobResult[] = new Array(jobs.length);
  const t0 = Date.now();
  let next = 0;
  let done = 0;
  let lastPrint = 0;
  let lastDone = -1;
  const tty = process.stderr.isTTY;
  const progress = (final = false): void => {
    const now = Date.now();
    if (!final && now - lastPrint < (tty ? 250 : 5000)) return;
    if (final && !tty && lastDone === done) return;
    lastPrint = now;
    lastDone = done;
    const el = now - t0;
    const eta = done ? (el / done) * (jobs.length - done) : 0;
    const line = `[${label}] ${done}/${jobs.length} (${pct(done / Math.max(1, jobs.length))}) · ${clock(el)} elapsed${done < jobs.length ? ` · ETA ${clock(eta)}` : ''}`;
    if (tty) process.stderr.write(`\r${line.padEnd(78)}${final ? '\n' : ''}`);
    else process.stderr.write(`${line}\n`);
  };
  await new Promise<void>((resolve) => {
    let live = 0;
    const feed = (w: Worker): void => {
      if (next >= order.length) {
        w.postMessage({ type: 'stop' } satisfies ToWorker);
        return;
      }
      const index = order[next++]!;
      (w as Worker & { current?: number }).current = index;
      w.postMessage({ type: 'job', index, job: jobs[index]! } satisfies ToWorker);
    };
    const start = (): void => {
      const w = spawn() as Worker & { current?: number };
      live++;
      w.on('message', (m: FromWorker) => {
        results[m.index] = m.result;
        w.current = undefined;
        done++;
        progress();
        feed(w);
      });
      w.on('error', (e) => {
        // A worker died mid-battle: record the battle as an error and carry on with a fresh worker.
        const i = w.current;
        if (i !== undefined && !results[i]) {
          const job = jobs[i]!;
          results[i] = {
            id: job.id,
            suite: job.suite,
            tags: job.tags,
            winner: -1,
            reason: 'error',
            time: 0,
            cpuMs: 0,
            sides: [0, 1].map((s) => ({ faction: job.tags.factions[s]!, cost: job.tags.costs[s]!, killed: 0, removed: 0, lost: 0, soldiers: 0, soldiersLost: 0 })) as JobResult['sides'],
            error: `worker crashed: ${String(e)}`,
          };
          done++;
        }
        w.current = undefined;
      });
      w.on('exit', () => {
        live--;
        if (done < jobs.length && next < order.length) start();
        else if (live === 0) resolve();
      });
      feed(w);
    };
    const n = Math.min(workers, jobs.length);
    if (n === 0) resolve();
    for (let i = 0; i < n; i++) start();
  });
  progress(true);
  return { results, wallMs: Date.now() - t0 };
}

function workerMain(): void {
  parentPort!.on('message', (m: ToWorker) => {
    if (m.type === 'stop') {
      parentPort!.close();
      return;
    }
    const result = runJob(m.job);
    parentPort!.postMessage({ type: 'result', index: m.index, result } satisfies FromWorker);
  });
}

// ------------------------------------------------------------------------ main

function clock(ms: number): string {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`;
}

function gitCommit(): string | undefined {
  try {
    const hash = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    const dirty = execSync('git status --porcelain --untracked-files=no -- src', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    return dirty ? `${hash}+changes` : hash;
  } catch {
    return undefined;
  }
}

async function main(): Promise<void> {
  let args: Args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n\n${HELP}`);
    process.exit(2);
  }
  const suites = (['factions', 'colossus', 'duels'] as SuiteId[]).filter((s) => args.suites.includes(s));
  process.stderr.write(`Balance run: ${suites.join(', ')} on ${args.workers} worker${args.workers === 1 ? '' : 's'}${args.quick ? ' (quick)' : ''}\n`);
  const all: JobResult[] = [];
  const timing: NonNullable<ReportMeta['timing']> = {};
  let loaded: ReportMeta | undefined;
  if (args.from) {
    const raw = JSON.parse(readFileSync(args.from, 'utf8')) as JobResult[] | { meta?: ReportMeta; results: JobResult[] };
    const list = Array.isArray(raw) ? raw : raw.results;
    if (!Array.isArray(raw)) loaded = raw.meta;
    all.push(...list.filter((r) => suites.includes(r.suite)));
    process.stderr.write(`Loaded ${all.length} results from ${args.from}\n`);
  }
  for (const suite of args.from ? [] : suites) {
    const t0 = Date.now();
    const jobs = buildJobs(args, suite);
    const buildMs = Date.now() - t0;
    if (!jobs.length) continue;
    const { results, wallMs } = await runPool(jobs, args.workers, suite);
    all.push(...results);
    timing[suite] = { jobs: jobs.length, wallMs: wallMs + buildMs, cpuMs: results.reduce((a, r) => a + r.cpuMs, 0) };
  }
  const fresh: ReportMeta = {
    generated: new Date().toISOString(),
    commit: gitCommit(),
    command: `npx tsx tools/balance.ts ${process.argv.slice(2).join(' ')}`.trim(),
    settings: {
      suites,
      seeds: args.seeds,
      factionScale: args.scale,
      budget: args.budget,
      armsBudget: DEFAULTS.armsBudget,
      factions: args.factions,
      conditions: args.conditions.length === CONDITIONS.length ? 'all 15' : args.conditions.map((c) => c.key),
      timeLimits: { factions: args.timeLimit, duels: args.quick ? QUICK_DUEL_LIMIT : DEFAULTS.duelTimeLimit, colossus: DEFAULTS.colossusTimeLimit },
      quick: args.quick,
      ...(args.salt ? { salt: args.salt } : {}),
    },
    timing,
    machine: `${args.workers} worker threads, ${cpus().length} cores, Node ${process.version}`,
  };
  // A rebuilt report keeps the settings and timing of the run that produced the results.
  const meta: ReportMeta = loaded ? { ...loaded, generated: fresh.generated, command: `${loaded.command ?? 'unknown'} (report rebuilt from ${args.from})` } : fresh;
  const report = buildReport(all, meta);
  mkdirSync(args.out, { recursive: true });
  const md = reportMarkdown(report);
  writeFileSync(join(args.out, 'balance-report.md'), md);
  // Four decimals is plenty for rates and ratios, and keeps the file and its diffs small.
  const round = (_: string, v: unknown): unknown => (typeof v === 'number' && !Number.isInteger(v) ? Math.round(v * 1e4) / 1e4 : v);
  writeFileSync(join(args.out, 'balance-report.json'), JSON.stringify(report, round, 1));
  if (args.raw) writeFileSync(join(args.out, 'balance-raw.tmp.json'), JSON.stringify({ meta, results: all }));
  // Summary.
  const out: string[] = [''];
  const runs = Object.entries(timing);
  if (runs.length) {
    const total = runs.reduce((a, [, t]) => a + t!.wallMs, 0);
    out.push(`Runtime: ${runs.map(([s, t]) => `${s} ${clock(t!.wallMs)} (${t!.jobs} battles)`).join(', ')}; total ${clock(total)}.`, '');
  }
  out.push('Targets:');
  for (const t of report.targets) out.push(`  ${t.id}. ${t.name.padEnd(36)} ${t.status.toUpperCase().padEnd(8)} ${t.summary}`);
  const shown = report.flags.filter((f) => f.severity !== 'info' && f.target !== 'formula');
  out.push('', `Flags: ${report.flags.filter((f) => f.severity === 'fail').length} fail, ${report.flags.filter((f) => f.severity === 'warn').length} warn, ${report.flags.filter((f) => f.severity === 'info').length} notes.`);
  for (const f of shown.slice(0, 12)) out.push(`  ${f.severity.toUpperCase().padEnd(5)} ${f.message}`);
  if (shown.length > 12) out.push(`  … ${shown.length - 12} more in the report.`);
  out.push('', `Wrote ${join(args.out, 'balance-report.md')} and ${join(args.out, 'balance-report.json')}${args.raw ? ` and ${join(args.out, 'balance-raw.tmp.json')}` : ''}.`);
  process.stdout.write(`${out.join('\n')}\n`);
}

if (isMainThread) {
  main().catch((e) => {
    process.stderr.write(`${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`);
    process.exit(1);
  });
} else {
  workerMain();
}
