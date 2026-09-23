/**
 * Balance Lab: runs a small balance suite in the browser on Web Workers and
 * shows the design doc's checks as the battles come in: the faction win-rate
 * matrix, win rates per light and wind condition, and the five targets.
 * The full suite (unit duels, every condition, more seeds) is `npm run balance`.
 */
import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import BalanceWorker from '../../balance/worker?worker&inline';
import type { LabToWorker, WorkerToLab } from '../../balance/worker';
import type { FactionId, LightLevel, WindLevel } from '../../data/schema';
import { FACTION_IDS, LIGHT_NAMES, WIND_NAMES } from '../../data/schema';
import { FACTIONS } from '../../data/index';
import { CONDITIONS, LIGHTS, WINDS } from '../../balance/conditions';
import type { BalanceJob } from '../../balance/suites';
import { colossusVsArms, factionMatchups, unitDuels } from '../../balance/suites';
import type { JobResult } from '../../balance/runner';
import { jobWeight } from '../../balance/runner';
import type { BalanceReport, ColossusSection, DuelSection, FactionSection, Flag, TargetStatus } from '../../balance/report';
import { buildReport, cap, pct, signedPct, TARGETS } from '../../balance/report';
import type { Rate } from '../../balance/stats';
import { bandSeverity } from '../../balance/stats';
import { go } from '../store';

interface LabConfig {
  factions: FactionId[];
  lights: LightLevel[];
  winds: WindLevel[];
  seeds: number;
  scale: 0.5 | 1;
  budget: number;
  colossus: boolean;
  duels: boolean;
}

const DEFAULT_CONFIG: LabConfig = {
  factions: [...FACTION_IDS],
  lights: [0, 2, 4],
  winds: [1],
  seeds: 1,
  scale: 1,
  budget: 12000,
  colossus: false,
  duels: false,
};

type RunState = 'idle' | 'running' | 'stopped' | 'done' | 'failed';

function workerCount(): number {
  const hc = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4;
  return Math.max(1, Math.min(4, hc - 1));
}

function buildJobs(c: LabConfig): BalanceJob[] {
  const conditions = CONDITIONS.filter((x) => c.lights.includes(x.light) && c.winds.includes(x.wind));
  const jobs = factionMatchups({ factions: c.factions, conditions, seeds: c.seeds, budget: c.budget, scale: c.scale });
  if (c.colossus) jobs.push(...colossusVsArms({ factions: c.factions, conditions, seeds: c.seeds }));
  if (c.duels) jobs.push(...unitDuels({ factions: c.factions, seeds: c.seeds }));
  return jobs;
}

/** Rough single-thread seconds per job, for the estimate shown before a run. */
function estimateSeconds(c: LabConfig): number {
  const conditions = c.lights.length * c.winds.length;
  const pairs = (c.factions.length * (c.factions.length - 1)) / 2;
  const f = pairs * conditions * c.seeds * 2 * (c.budget / 12000) * (c.scale === 1 ? 5.5 : 2.3);
  const col = c.colossus ? c.factions.length * (c.factions.length - 1) * conditions * c.seeds * 2 * 0.9 : 0;
  const duel = c.duels ? pairs * 121 * c.seeds * 2 * 0.5 : 0;
  return (f + col + duel) / Math.max(1, workerCount() * 0.7);
}

/** Runs jobs on a few workers, one job per worker at a time, longest first. */
class LabPool {
  private workers = new Set<Worker>();
  private order: number[];
  private next = 0;
  private stopped = false;

  constructor(
    private readonly jobs: BalanceJob[],
    private readonly onResult: (index: number, r: JobResult) => void,
    private readonly onDone: (error?: string) => void,
  ) {
    this.order = jobs.map((_, i) => i).sort((a, b) => jobWeight(jobs[b]!) - jobWeight(jobs[a]!) || a - b);
  }

  start(n: number): void {
    for (let k = 0; k < Math.min(n, this.jobs.length); k++) this.spawn();
    if (!this.jobs.length) this.onDone();
  }

  private spawn(): void {
    const w = new BalanceWorker({ name: 'balance' });
    w.onmessage = (e: MessageEvent<WorkerToLab>) => {
      if (this.stopped) return;
      this.onResult(e.data.index, e.data.result);
      this.feed(w);
    };
    w.onerror = (e: ErrorEvent) => {
      // The runner catches simulation errors itself, so this is the worker failing outright.
      e.preventDefault();
      if (this.stopped) return;
      this.stop();
      this.onDone(`A balance worker failed: ${e.message || 'unknown error'}`);
    };
    this.workers.add(w);
    this.feed(w);
  }

  private feed(w: Worker): void {
    if (this.next >= this.order.length) {
      w.terminate();
      this.workers.delete(w);
      if (!this.workers.size && !this.stopped) this.onDone();
      return;
    }
    const index = this.order[this.next++]!;
    const msg: LabToWorker = { type: 'job', index, job: this.jobs[index]! };
    w.postMessage(msg);
  }

  stop(): void {
    this.stopped = true;
    for (const w of this.workers) w.terminate();
    this.workers.clear();
  }
}

export function BalanceLab() {
  const [config, setConfig] = useState<LabConfig>(DEFAULT_CONFIG);
  const [state, setState] = useState<RunState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0, started: 0, ended: 0 });
  const [report, setReport] = useState<BalanceReport | null>(null);
  const [ran, setRan] = useState<LabConfig | null>(null);
  const [, setTick] = useState(0);
  const pool = useRef<LabPool | null>(null);
  const results = useRef<JobResult[]>([]);
  const flushTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      pool.current?.stop();
      if (flushTimer.current !== null) window.clearTimeout(flushTimer.current);
    },
    [],
  );
  // Keep the elapsed clock moving while a run is going.
  useEffect(() => {
    if (state !== 'running') return;
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [state]);

  const flush = (cfg: LabConfig): void => {
    flushTimer.current = null;
    const list = results.current.filter(Boolean);
    setProgress((p) => ({ ...p, done: list.length }));
    if (!list.length) return;
    setReport(
      buildReport(list, {
        generated: new Date().toISOString(),
        settings: { factions: cfg.factions, lights: cfg.lights.map((l) => LIGHT_NAMES[l]), winds: cfg.winds.map((w) => WIND_NAMES[w]), seeds: cfg.seeds, scale: cfg.scale, budget: cfg.budget },
      }),
    );
  };

  const run = (): void => {
    pool.current?.stop();
    const cfg = config;
    const jobs = buildJobs(cfg);
    results.current = new Array(jobs.length);
    setReport(null);
    setError(null);
    setRan(cfg);
    setProgress({ done: 0, total: jobs.length, started: Date.now(), ended: 0 });
    setState('running');
    const p = new LabPool(
      jobs,
      (i, r) => {
        results.current[i] = r;
        if (flushTimer.current === null) flushTimer.current = window.setTimeout(() => flush(cfg), 300);
      },
      (err) => {
        if (flushTimer.current !== null) window.clearTimeout(flushTimer.current);
        flush(cfg);
        setProgress((pr) => ({ ...pr, ended: Date.now() }));
        if (err) {
          setError(err);
          setState('failed');
        } else setState('done');
      },
    );
    pool.current = p;
    p.start(workerCount());
  };

  const stop = (): void => {
    pool.current?.stop();
    pool.current = null;
    if (flushTimer.current !== null) window.clearTimeout(flushTimer.current);
    if (ran) flush(ran);
    setProgress((p) => ({ ...p, ended: Date.now() }));
    setState('stopped');
  };

  const running = state === 'running';
  return (
    <div class="screen lab-screen">
      <div class="lab scroll">
        <header class="lab-head spread">
          <div>
            <h1 class="lab-title">Balance Lab</h1>
            <p class="muted lab-lede">
              Automated battles at equal cost, fought by the same scripted AI on both sides. Every fixture is fought twice with the sides swapped, and the sun turns north, east, south and west across fixtures.
            </p>
          </div>
          <button class="btn" onClick={() => go({ name: 'menu' })}>
            Back to menu
          </button>
        </header>
        <SetupPanel config={config} setConfig={setConfig} running={running} onRun={run} onStop={stop} />
        {state !== 'idle' && <ProgressPanel state={state} progress={progress} error={error} />}
        <TargetsPanel targets={report?.targets ?? null} config={ran} />
        {report?.factions && ran && (
          <div class="lab-grid">
            <MatrixPanel f={report.factions} />
            <FlagsPanel flags={report.flags} />
          </div>
        )}
        {report?.factions && ran && <ConditionsPanel f={report.factions} config={ran} />}
        {report?.colossus && <ColossusPanel c={report.colossus} />}
        {report?.duels && <DuelsPanel d={report.duels} />}
        {!report && state === 'idle' && <EmptyPanel />}
        <p class="lab-foot muted">
          For the full suite (all 15 conditions, unit duels, counters and the cost formula) run <code>npm run balance</code>; it writes <code>reports/balance-report.md</code>.
        </p>
      </div>
      <Tooltip />
    </div>
  );
}

// ------------------------------------------------------------------ setup

function Toggle({ on, onClick, children, disabled, title }: { on: boolean; onClick: () => void; children: ComponentChildren; disabled?: boolean; title?: string }) {
  return (
    <button class={`btn small${on ? ' on' : ''}`} aria-pressed={on} onClick={onClick} disabled={disabled} title={title}>
      {children}
    </button>
  );
}

function toggleIn<T>(list: T[], v: T, min: number): T[] {
  if (list.includes(v)) return list.length > min ? list.filter((x) => x !== v) : list;
  return [...list, v];
}

function SetupPanel({ config: c, setConfig, running, onRun, onStop }: { config: LabConfig; setConfig: (c: LabConfig) => void; running: boolean; onRun: () => void; onStop: () => void }) {
  const set = (patch: Partial<LabConfig>) => setConfig({ ...c, ...patch });
  const conditions = c.lights.length * c.winds.length;
  const pairs = (c.factions.length * (c.factions.length - 1)) / 2;
  const battles = pairs * conditions * c.seeds * 2 + (c.colossus ? c.factions.length * (c.factions.length - 1) * conditions * c.seeds * 2 : 0) + (c.duels ? pairs * 121 * c.seeds * 2 : 0);
  const est = estimateSeconds(c);
  return (
    <section class="panel lab-panel lab-setup" aria-label="Suite setup">
      <div class="lab-field">
        <span class="label">Factions</span>
        <div class="row">
          {FACTION_IDS.map((f) => (
            <Toggle key={f} on={c.factions.includes(f)} disabled={running} onClick={() => set({ factions: FACTION_IDS.filter((x) => (x === f ? !c.factions.includes(f) || c.factions.length <= 2 : c.factions.includes(x))) })}>
              <span class="lab-swatch" style={{ background: `var(--${f})` }} />
              {FACTIONS[f].short}
            </Toggle>
          ))}
        </div>
      </div>
      <div class="lab-field">
        <span class="label">Light</span>
        <div class="row">
          {LIGHTS.map((l) => (
            <Toggle key={l} on={c.lights.includes(l)} disabled={running} onClick={() => set({ lights: toggleIn(c.lights, l, 1).sort((x, y) => x - y) })}>
              {LIGHT_NAMES[l]}
            </Toggle>
          ))}
        </div>
      </div>
      <div class="lab-field">
        <span class="label">Wind</span>
        <div class="row">
          {WINDS.map((w) => (
            <Toggle key={w} on={c.winds.includes(w)} disabled={running} onClick={() => set({ winds: toggleIn(c.winds, w, 1).sort((x, y) => x - y) })}>
              {WIND_NAMES[w]}
            </Toggle>
          ))}
        </div>
      </div>
      <div class="lab-field">
        <span class="label">Fixtures per condition</span>
        <div class="row">
          <button class="btn small" aria-label="Fewer fixtures" disabled={running || c.seeds <= 1} onClick={() => set({ seeds: c.seeds - 1 })}>
            −
          </button>
          <span class="num lab-count">{c.seeds}</span>
          <button class="btn small" aria-label="More fixtures" disabled={running || c.seeds >= 8} onClick={() => set({ seeds: c.seeds + 1 })}>
            +
          </button>
          <span class="muted lab-hint">each fought twice, sides swapped</span>
        </div>
      </div>
      <div class="lab-field">
        <span class="label">Unit size</span>
        <div class="row">
          <Toggle on={c.scale === 1} disabled={running} onClick={() => set({ scale: 1 })} title="Every unit at full size: the fair test">
            Full (fair)
          </Toggle>
          <Toggle on={c.scale === 0.5} disabled={running} onClick={() => set({ scale: 0.5 })} title="Infantry and cavalry at half size; monsters, artillery, heroes and colossi stay full, so they count double">
            Half (fast)
          </Toggle>
        </div>
      </div>
      <div class="lab-field">
        <span class="label">Army budget</span>
        <div class="row">
          {[6000, 9000, 12000].map((b) => (
            <Toggle key={b} on={c.budget === b} disabled={running} onClick={() => set({ budget: b })}>
              {b.toLocaleString('en-US')}
            </Toggle>
          ))}
        </div>
      </div>
      <div class="lab-field">
        <span class="label">Also run</span>
        <div class="row">
          <Toggle on={c.colossus} disabled={running} onClick={() => set({ colossus: !c.colossus })} title="Each colossus alone against 3,200 points of each enemy faction">
            Colossus vs arms
          </Toggle>
          <Toggle on={c.duels} disabled={running} onClick={() => set({ duels: !c.duels })} title="Every unit against every enemy-faction unit at equal cost, Dusk and Breeze">
            Unit duels (slow)
          </Toggle>
        </div>
      </div>
      <div class="spread lab-run">
        <span class="muted">
          <span class="num">{battles.toLocaleString('en-US')}</span> battles · about {fmtDuration(est * 1000)} on {workerCount()} worker{workerCount() === 1 ? '' : 's'}
        </span>
        <div class="row">
          {running ? (
            <button class="btn danger" onClick={onStop}>
              Stop
            </button>
          ) : (
            <button class="btn primary" onClick={onRun}>
              Run suite
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

function ProgressPanel({ state, progress: p, error }: { state: RunState; progress: { done: number; total: number; started: number; ended: number }; error: string | null }) {
  const now = p.ended || Date.now();
  const elapsed = now - p.started;
  const eta = p.done ? (elapsed / p.done) * (p.total - p.done) : 0;
  const share = p.total ? p.done / p.total : 0;
  const label = state === 'running' ? 'Running' : state === 'done' ? 'Finished' : state === 'stopped' ? 'Stopped' : 'Failed';
  return (
    <section class="panel lab-panel lab-progress" aria-live="polite">
      <div class="spread">
        <b>{label}</b>
        <span class="num muted">
          {p.done} / {p.total} battles · {fmtDuration(elapsed)} elapsed{state === 'running' && p.done ? ` · about ${fmtDuration(eta)} left` : ''}
        </span>
      </div>
      <div class="lab-meter" role="progressbar" aria-valuemin={0} aria-valuemax={p.total} aria-valuenow={p.done} aria-label="Battles finished">
        <i style={{ width: `${(share * 100).toFixed(1)}%` }} />
      </div>
      {error && <p class="lab-error">{error}</p>}
    </section>
  );
}

// ---------------------------------------------------------------- targets

const STATUS_CHIP: Record<TargetStatus['status'], { cls: string; icon: string; text: string }> = {
  pass: { cls: 'good', icon: '✓', text: 'Pass' },
  warn: { cls: 'warn', icon: '!', text: 'Check' },
  fail: { cls: 'bad', icon: '✗', text: 'Fail' },
  thin: { cls: '', icon: '?', text: 'Too few' },
  'not run': { cls: '', icon: '–', text: 'Not run' },
};

const TARGET_ROWS: { id: TargetStatus['id']; name: string; goal: string }[] = [
  { id: 1, name: 'Faction vs faction', goal: '45–55% wins at equal cost, over all conditions' },
  { id: 2, name: 'Best and worst conditions', goal: 'never above 60% or below 40% wins' },
  { id: 3, name: 'Cost efficiency in role', goal: 'within ±10% of the role median' },
  { id: 4, name: 'Counters', goal: '2+ cheaper-or-equal counters in each enemy faction' },
  { id: 5, name: 'Colossus vs combined arms', goal: 'colossus wins 40–50%' },
];

function TargetsPanel({ targets, config }: { targets: TargetStatus[] | null; config: LabConfig | null }) {
  return (
    <section class="panel lab-panel" aria-label="The design doc's targets">
      <h2 class="lab-h2">Targets</h2>
      <ul class="lab-targets">
        {TARGET_ROWS.map((row) => {
          const t = targets?.find((x) => x.id === row.id);
          const status = t?.status ?? 'not run';
          const chip = STATUS_CHIP[status];
          let note = t?.summary ?? 'Not run yet.';
          if (status === 'not run' && config) note = row.id === 5 ? 'Tick “Colossus vs arms” to measure.' : row.id >= 3 ? 'Tick “Unit duels” to measure.' : note;
          return (
            <li key={row.id}>
              <span class={`chip ${chip.cls}`} aria-label={`Target ${row.id}: ${chip.text}`}>
                <span aria-hidden="true">{chip.icon}</span> {chip.text}
              </span>
              <div>
                <b>
                  {row.id}. {row.name}
                </b>{' '}
                <span class="muted">— {row.goal}</span>
                <div class="lab-note">{note}</div>
              </div>
            </li>
          );
        })}
      </ul>
      <p class="muted lab-small">“Fail” means the whole 95% interval misses the target. “Check” means the estimate misses but the interval still reaches the target: run more fixtures to tell.</p>
    </section>
  );
}

function EmptyPanel() {
  return (
    <section class="panel lab-panel lab-empty">
      <h2 class="lab-h2">How it works</h2>
      <p class="muted">
        Pick factions and conditions, then run. Each pairing of factions fights with armies of the same budget in every chosen light and wind; win rates stream in as battles finish. Balance starts from a cost formula, then gets verified by automated battles until every faction wins 45–55% of fights at equal cost.
      </p>
    </section>
  );
}

// ----------------------------------------------------------------- matrix

type Sev = 'ok' | 'warn' | 'fail';
const SEV_GLYPH: Record<Sev, string> = { ok: '✓', warn: '!', fail: '✗' };
const SEV_WORD: Record<Sev, string> = { ok: 'within target', warn: 'outside target, within noise', fail: 'clearly outside target' };

function sevOf(r: Rate, min: number, max: number): Sev {
  return bandSeverity(r.rate, r.lo, r.hi, min, max);
}

function rateText(r: Rate): string {
  return `${pct(r.rate)} wins (95%: ${pct(r.lo)}–${pct(r.hi)}) · ${r.n} battle${r.n === 1 ? '' : 's'}`;
}

function MatrixCell({ r, label }: { r: Rate | undefined; label: string }) {
  if (!r || !r.n) return <td class="lab-cell empty">—</td>;
  const sev = sevOf(r, TARGETS.factionAvg.min, TARGETS.factionAvg.max);
  const tip = `${label}: ${rateText(r)}; ${SEV_WORD[sev]}`;
  return (
    <td class={`lab-cell ${sev}`} tabIndex={0} aria-label={tip} {...tipHandlers(tip)}>
      <span class="lab-cell-v">{pct(r.rate)}</span>
      <span class="lab-cell-g" aria-hidden="true">
        {SEV_GLYPH[sev]}
      </span>
      <span class="lab-cell-n num">n {r.n}</span>
    </td>
  );
}

function MatrixPanel({ f }: { f: FactionSection }) {
  return (
    <section class="panel lab-panel" aria-label="Faction win-rate matrix">
      <h2 class="lab-h2">Win-rate matrix</h2>
      <p class="muted lab-small">% wins of the row faction against the column faction, over the conditions run. Target 45–55%.</p>
      <div class="lab-table-wrap">
        <table class="lab-matrix">
          <thead>
            <tr>
              <th scope="col">
                <span class="sr-only">Row faction</span>
              </th>
              {f.factions.map((b) => (
                <th scope="col" key={b}>
                  <span class="lab-swatch" style={{ background: `var(--${b})` }} />
                  {FACTIONS[b].short}
                </th>
              ))}
              <th scope="col">vs field</th>
            </tr>
          </thead>
          <tbody>
            {f.factions.map((a) => (
              <tr key={a}>
                <th scope="row">
                  <span class="lab-swatch" style={{ background: `var(--${a})` }} />
                  {FACTIONS[a].short}
                </th>
                {f.factions.map((b) => (a === b ? <td key={b} class="lab-cell diag" aria-label="same faction">·</td> : <MatrixCell key={b} r={f.matrix[a]?.[b]} label={`${cap(a)} vs ${cap(b)}`} />))}
                <MatrixCell r={f.vsField[a]} label={`${cap(a)} vs the field`} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p class="muted lab-small">
        {f.battles} battles · {f.timeouts} decided on the timer · side 0 (bottom edge) won {pct(f.side0.rate)}
        {f.colossusEdge.n ? ` · an army with its colossus beat one without ${pct(f.colossusEdge.rate)} of ${f.colossusEdge.n}` : ''}
      </p>
    </section>
  );
}

// ------------------------------------------------------------- conditions

function ConditionsPanel({ f, config }: { f: FactionSection; config: LabConfig }) {
  const [table, setTable] = useState(false);
  const conds = CONDITIONS.filter((c) => config.lights.includes(c.light) && config.winds.includes(c.wind));
  const multiWind = config.winds.length > 1;
  return (
    <section class="panel lab-panel" aria-label="Win rate by condition">
      <div class="spread">
        <h2 class="lab-h2">By light and wind</h2>
        <button class="btn small ghost" aria-pressed={table} onClick={() => setTable(!table)}>
          {table ? 'Show chart' : 'Show table'}
        </button>
      </div>
      <p class="muted lab-small">
        % wins against every other faction in each condition{multiWind ? ` (bars within a light level: ${config.winds.map((w) => WIND_NAMES[w]).join(', ')})` : ` (${WIND_NAMES[config.winds[0]!]})`}. Shaded band: the 40–60% target. Whiskers: 95% interval.
      </p>
      {table ? (
        <div class="lab-table-wrap">
          <table class="lab-plain">
            <thead>
              <tr>
                <th scope="col">Faction</th>
                {conds.map((c) => (
                  <th scope="col" key={c.index}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {f.factions.map((a) => (
                <tr key={a}>
                  <th scope="row">{FACTIONS[a].short}</th>
                  {conds.map((c) => {
                    const r = f.byCondition[a]![c.index]!;
                    return (
                      <td key={c.index} class="num">
                        {r.n ? `${pct(r.rate)} (${r.n})` : '—'}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          <div class="lab-multiples">
            {f.factions.map((a) => (
              <ConditionChart key={a} faction={a} f={f} lights={config.lights} winds={config.winds} />
            ))}
          </div>
          <div class="lab-legend muted" aria-hidden="true">
            <span>
              <i class="lab-key ok" /> within 40–60%
            </span>
            <span>
              <i class="lab-key warn" /> ! outside, within noise
            </span>
            <span>
              <i class="lab-key fail" /> ✗ clearly outside
            </span>
            <span>
              <i class="lab-key band" /> target band
            </span>
          </div>
        </>
      )}
    </section>
  );
}

const PLOT_H = 140;

function ConditionChart({ faction, f, lights, winds }: { faction: FactionId; f: FactionSection; lights: LightLevel[]; winds: WindLevel[] }) {
  const y = (v: number) => (1 - v) * PLOT_H;
  const band = TARGETS.factionCond;
  return (
    <figure class="lab-chart">
      <figcaption>
        <span class="lab-swatch" style={{ background: `var(--${faction})` }} />
        <b>{FACTIONS[faction].short}</b>
        <span class="muted"> · % wins vs the field</span>
      </figcaption>
      <div class="lab-plot" style={{ height: `${PLOT_H}px` }}>
        {[1, 0.75, 0.5, 0.25, 0].map((v) => (
          <div key={v} class={`lab-grid-line${v === 0.5 ? ' base' : ''}`} style={{ top: `${y(v)}px` }}>
            <span class="num">{Math.round(v * 100)}%</span>
          </div>
        ))}
        <div class="lab-band" style={{ top: `${y(band.max)}px`, height: `${y(band.min) - y(band.max)}px` }} />
        <div class="lab-bars">
          {lights.map((l) => (
            <div class="lab-group" key={l}>
              <div class="lab-group-bars">
                {winds.map((w) => {
                  const c = CONDITIONS[l * 3 + w]!;
                  const r = f.byCondition[faction]![c.index]!;
                  return <Bar key={w} r={r} label={`${FACTIONS[faction].short} · ${c.label}`} y={y} />;
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div class="lab-xaxis">
        {lights.map((l) => (
          <div class="lab-group" key={l}>
            <div class="lab-group-bars lab-marks" aria-hidden="true">
              {winds.map((w) => {
                const r = f.byCondition[faction]![l * 3 + w]!;
                const sev = r.n ? sevOf(r, band.min, band.max) : 'ok';
                return <span key={w}>{sev === 'ok' ? '' : SEV_GLYPH[sev]}</span>;
              })}
            </div>
            {winds.length > 1 && (
              <div class="lab-group-bars lab-winds" aria-hidden="true">
                {winds.map((w) => (
                  <span key={w}>{WIND_NAMES[w]![0]}</span>
                ))}
              </div>
            )}
            <span class="lab-xlabel">{LIGHT_NAMES[l]}</span>
          </div>
        ))}
      </div>
    </figure>
  );
}

function Bar({ r, label, y }: { r: Rate; label: string; y: (v: number) => number }) {
  if (!r.n) return <div class="lab-bar-slot" aria-label={`${label}: not run yet`} />;
  const sev = sevOf(r, TARGETS.factionCond.min, TARGETS.factionCond.max);
  const up = r.rate >= 0.5;
  const top = up ? y(r.rate) : y(0.5);
  const h = Math.max(2, Math.abs(y(r.rate) - y(0.5)));
  const tip = `${label}: ${rateText(r)}; ${SEV_WORD[sev]}`;
  return (
    <div class="lab-bar-slot" tabIndex={0} aria-label={tip} {...tipHandlers(tip)}>
      <div class="lab-whisker" style={{ top: `${y(r.hi)}px`, height: `${Math.max(1, y(r.lo) - y(r.hi))}px` }} />
      <div class={`lab-bar ${sev} ${up ? 'up' : 'down'}`} style={{ top: `${top}px`, height: `${h}px` }} />
    </div>
  );
}

// --------------------------------------------------------- colossus, duels

function ColossusPanel({ c }: { c: ColossusSection }) {
  const T = TARGETS.colossus;
  return (
    <section class="panel lab-panel" aria-label="Colossus against combined arms">
      <h2 class="lab-h2">Colossus vs combined arms</h2>
      <p class="muted lab-small">Each colossus alone against about 3,200 points of an enemy faction's troops. Target: the colossus wins 40–50%.</p>
      <div class="lab-table-wrap">
        <table class="lab-plain">
          <thead>
            <tr>
              <th scope="col">Colossus</th>
              <th scope="col">% wins</th>
              {FACTION_IDS.map((f) => (
                <th scope="col" key={f}>
                  vs {FACTIONS[f].short}
                </th>
              ))}
              <th scope="col">Mean length</th>
            </tr>
          </thead>
          <tbody>
            {c.rows.map((r) => {
              const sev = sevOf(r.vsArms, T.min, T.max);
              return (
                <tr key={r.id}>
                  <th scope="row">{r.name}</th>
                  <td>
                    <span class={`chip ${sev === 'ok' ? 'good' : sev === 'warn' ? 'warn' : 'bad'}`}>
                      <span aria-hidden="true">{SEV_GLYPH[sev]}</span> <span class="num">{pct(r.vsArms.rate)}</span>
                    </span>{' '}
                    <span class="muted num lab-small">
                      {pct(r.vsArms.lo)}–{pct(r.vsArms.hi)}, n {r.vsArms.n}
                    </span>
                  </td>
                  {FACTION_IDS.map((f) => (
                    <td key={f} class="num">
                      {r.byFaction[f]?.n ? `${pct(r.byFaction[f]!.rate)} (${r.byFaction[f]!.n})` : '—'}
                    </td>
                  ))}
                  <td class="num">{Math.round(r.meanTime)} s</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function DuelsPanel({ d }: { d: DuelSection }) {
  const [all, setAll] = useState(false);
  const rows = useMemo(() => [...d.units].sort((a, b) => Math.abs(b.deviation) - Math.abs(a.deviation)), [d]);
  const shown = all ? rows : rows.slice(0, 12);
  const counterFails = d.counters.flatMap((c) => Object.entries(c.byFaction).filter(([, x]) => x!.status === 'fail').map(([f]) => `${c.name} vs ${cap(f)}`));
  return (
    <section class="panel lab-panel" aria-label="Unit duels">
      <div class="spread">
        <h2 class="lab-h2">Unit duels: cost efficiency in role</h2>
        <button class="btn small ghost" onClick={() => setAll(!all)}>
          {all ? 'Show top 12' : `Show all ${rows.length}`}
        </button>
      </div>
      <p class="muted lab-small">
        {d.battles} duels at equal cost. Efficiency: enemy points destroyed per own point lost, compared with the median of the unit's role (target ±10%). Sorted by distance from the median.
      </p>
      <div class="lab-table-wrap">
        <table class="lab-plain">
          <thead>
            <tr>
              <th scope="col">Unit</th>
              <th scope="col">Role</th>
              <th scope="col">Cost</th>
              <th scope="col">Duel wins</th>
              <th scope="col">Efficiency</th>
              <th scope="col">vs role median</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((u) => (
              <tr key={u.id}>
                <th scope="row">
                  <span class="lab-swatch" style={{ background: `var(--${u.faction})` }} />
                  {u.name}
                </th>
                <td>{u.role}</td>
                <td class="num">{u.cost}</td>
                <td class="num">{pct(u.winRate.rate)}</td>
                <td class="num">{u.exchange.toFixed(2)}</td>
                <td>
                  {u.severity && u.severity !== 'info' ? (
                    <span class={`chip ${u.severity === 'fail' ? 'bad' : 'warn'}`}>
                      <span aria-hidden="true">{u.severity === 'fail' ? '✗' : '!'}</span> <span class="num">{signedPct(u.deviation)}</span>
                    </span>
                  ) : (
                    <span class="num">{signedPct(u.deviation)}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p class="muted lab-small">
        Counters missing: {counterFails.length ? counterFails.slice(0, 12).join('; ') + (counterFails.length > 12 ? ` and ${counterFails.length - 12} more` : '') : 'none'}.
      </p>
    </section>
  );
}

function FlagsPanel({ flags }: { flags: Flag[] }) {
  const list = flags.filter((f) => f.severity !== 'info' && f.target !== 'formula').slice(0, 10);
  const more = flags.filter((f) => f.severity !== 'info' && f.target !== 'formula').length - list.length;
  return (
    <section class="panel lab-panel" aria-label="Flags">
      <h2 class="lab-h2">Flags</h2>
      {list.length ? (
        <ul class="lab-flags">
          {list.map((f, i) => (
            <li key={i}>
              <span class={`chip ${f.severity === 'fail' ? 'bad' : 'warn'}`}>
                <span aria-hidden="true">{f.severity === 'fail' ? '✗' : '!'}</span> {f.severity === 'fail' ? 'Fail' : 'Check'}
              </span>
              <span>{f.message}</span>
            </li>
          ))}
          {more > 0 && <li class="muted">…and {more} more.</li>}
        </ul>
      ) : (
        <p class="muted">No targets missed so far.</p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- tooltip

const tipState = { set: null as ((t: { text: string; x: number; y: number } | null) => void) | null };

function tipHandlers(text: string) {
  return {
    onPointerMove: (e: PointerEvent) => tipState.set?.({ text, x: e.clientX, y: e.clientY }),
    onPointerLeave: () => tipState.set?.(null),
    onFocus: (e: FocusEvent) => {
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      tipState.set?.({ text, x: r.left + r.width / 2, y: r.top });
    },
    onBlur: () => tipState.set?.(null),
  };
}

function Tooltip() {
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null);
  useEffect(() => {
    tipState.set = setTip;
    return () => {
      tipState.set = null;
    };
  }, []);
  if (!tip) return null;
  const left = Math.min(Math.max(8, tip.x + 12), window.innerWidth - 280);
  const top = Math.max(8, tip.y - 44);
  return (
    <div class="panel tip lab-tip" role="tooltip" style={{ left: `${left}px`, top: `${top}px`, position: 'fixed' }}>
      {tip.text}
    </div>
  );
}

function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m} min ${String(s % 60).padStart(2, '0')} s` : `${Math.floor(m / 60)} h ${m % 60} min`;
}
