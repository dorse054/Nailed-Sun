/**
 * A small pool of simulation workers. Battles run off the main thread so
 * the page stays responsive; if workers are unavailable (tests, old
 * browsers, a strict page policy) they run on the main thread in slices.
 */
import type { BattleResult, BattleSetup } from './types';
import { runAuto, runAutoSliced } from './auto';

interface Job {
  id: number;
  setup: BattleSetup;
  resolve: (r: BattleResult) => void;
  reject: (e: Error) => void;
}

type WorkerCtor = new () => Worker;

class SimPool {
  private workers: Worker[] = [];
  private idle: Worker[] = [];
  private queue: Job[] = [];
  private running = new Map<Worker, Job>();
  private nextId = 1;
  private broken = false;
  private ready: Promise<void> | null = null;

  private init(): Promise<void> {
    if (this.ready) return this.ready;
    this.ready = (async () => {
      if (typeof Worker === 'undefined' || typeof window === 'undefined') {
        this.broken = true;
        return;
      }
      try {
        const mod = (await import('./simWorker?worker&inline')) as { default: WorkerCtor };
        const n = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1));
        for (let i = 0; i < n; i++) {
          const w = new mod.default();
          w.onmessage = (e: MessageEvent<{ id: number; result?: BattleResult; error?: string }>) => this.done(w, e.data);
          w.onerror = (e) => this.fail(w, e.message || 'worker error');
          this.workers.push(w);
          this.idle.push(w);
        }
      } catch {
        this.broken = true;
      }
    })();
    return this.ready;
  }

  async run(setup: BattleSetup): Promise<BattleResult> {
    await this.init();
    if (this.broken || !this.workers.length) return runAutoSliced(setup);
    return new Promise((resolve, reject) => {
      this.queue.push({ id: this.nextId++, setup, resolve, reject });
      this.pump();
    });
  }

  private pump(): void {
    while (this.idle.length && this.queue.length) {
      const w = this.idle.pop()!;
      const job = this.queue.shift()!;
      this.running.set(w, job);
      w.postMessage({ id: job.id, setup: job.setup });
    }
  }

  private done(w: Worker, msg: { id: number; result?: BattleResult; error?: string }): void {
    const job = this.running.get(w);
    this.running.delete(w);
    this.idle.push(w);
    if (job) {
      if (msg.result) job.resolve(msg.result);
      else {
        // Retry on the main thread rather than lose the battle.
        runAutoSliced(job.setup).then(job.resolve, job.reject);
      }
    }
    this.pump();
  }

  private fail(w: Worker, _why: string): void {
    const job = this.running.get(w);
    this.running.delete(w);
    this.workers = this.workers.filter((x) => x !== w);
    w.terminate();
    if (!this.workers.length) this.broken = true;
    if (job) runAutoSliced(job.setup).then(job.resolve, job.reject);
    // Anything still queued falls back when no workers remain.
    if (this.broken) {
      const q = this.queue.splice(0);
      for (const j of q) runAutoSliced(j.setup).then(j.resolve, j.reject);
    } else this.pump();
  }
}

let pool: SimPool | null = null;

/** Runs a battle to the end with the scripted AI on both sides. */
export function simulate(setup: BattleSetup): Promise<BattleResult> {
  pool = pool ?? new SimPool();
  return pool.run(setup);
}

/** Synchronous, for tests and tools. */
export function simulateNow(setup: BattleSetup): BattleResult {
  return runAuto(setup);
}
