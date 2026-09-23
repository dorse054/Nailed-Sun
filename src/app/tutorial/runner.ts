/**
 * Runs one tutorial against a battle: which step is showing, when it is done,
 * holding the battle for reading, and the outcome. It knows nothing about the
 * DOM, so tests drive it with a headless host.
 */
import { signal } from '@preact/signals';
import type { Command } from '../../sim/types';
import { TutorialContext, type RunState } from './context';
import { TutorialEnemy } from './enemy';
import { markComplete } from './progress';
import type { Dyn, TutorialDef, TutorialHost, TutorialStep, View } from './types';

export type RunStatus = 'running' | 'won' | 'lost';

/** How long a finished step shows its check mark before the next one, in ms. */
const DONE_FLASH = 900;

export function resolve<T>(v: Dyn<T> | undefined, c: TutorialContext): T | undefined {
  return typeof v === 'function' ? (v as (c: TutorialContext) => T)(c) : v;
}

export class TutorialRun implements RunState {
  readonly def: TutorialDef;
  readonly enemy = new TutorialEnemy();
  readonly ctx: TutorialContext;
  /** Bumped whenever the panel should re-render. */
  readonly version = signal(0);
  host: TutorialHost | null = null;
  index = 0;
  status: RunStatus = 'running';
  touch = false;
  stepStart = 0;
  stepCmd = 0;
  readonly cmds: { t: number; cmd: Command }[] = [];
  lineOrders = 0;
  /** Steps whose condition was met (or that were skipped). */
  readonly completed = new Set<string>();
  /** Brings a world area into view; the battle screen sets it. */
  onView: ((v: View) => void) | null = null;
  private entered = new Set<string>();
  private skipped = new Set<string>();
  /** The battle is paused because a step asked for it. */
  holding = false;
  /** A step wants the battle paused once it has run its first tick (so every HUD readout is live). */
  private pausePending = false;
  /** Real time (ms) the current step's check mark stops showing, or 0. */
  private flashUntil = 0;
  private now = 0;
  private previewAt = -Infinity;

  constructor(def: TutorialDef) {
    this.def = def;
    this.ctx = new TutorialContext(this);
  }

  get step(): TutorialStep | undefined {
    return this.def.steps[this.index];
  }

  get total(): number {
    return this.def.steps.length;
  }

  /** The step shows its check mark before moving on. */
  get flashing(): boolean {
    return this.flashUntil > 0;
  }

  /** Revisiting a step that is already done: it waits for Next. */
  get reviewing(): boolean {
    const st = this.step;
    return !!st && this.completed.has(st.id) && !this.flashing;
  }

  /** The step waits for Next rather than for the player to do something. */
  get waitsForNext(): boolean {
    const st = this.step;
    return !!st && (!st.done || this.reviewing);
  }

  attach(host: TutorialHost, now = 0): void {
    this.host = host;
    this.now = now;
    host.onIssue = (cmd) => this.onCommand(cmd);
    this.go(0);
  }

  detach(): void {
    if (this.host && this.holding && this.host.paused) this.host.paused = false;
    if (this.host) this.host.onIssue = null;
    this.holding = false;
  }

  /** Call every frame. */
  update(now: number): void {
    this.now = now;
    const h = this.host;
    if (!h || this.status !== 'running') return;
    if (h.overlay.preview.length) this.previewAt = now;
    if (h.phase === 'over') {
      this.finish();
      return;
    }
    if (this.pausePending && h.battle.tick > 0) {
      this.pausePending = false;
      if (!h.paused) {
        h.paused = true;
        this.holding = true;
        this.bump();
      }
    }
    // The player resumed the battle themselves.
    if (this.holding && !h.paused) this.holding = false;
    if (this.flashUntil) {
      if (now >= this.flashUntil) {
        this.flashUntil = 0;
        this.go(this.index + 1);
      }
      return;
    }
    const st = this.step;
    if (st?.done && !this.completed.has(st.id) && st.done(this.ctx)) {
      this.completed.add(st.id);
      this.flashUntil = now + DONE_FLASH;
      this.bump();
    }
  }

  next(): void {
    if (this.status !== 'running' || !this.waitsForNext) return;
    const st = this.step;
    if (st) this.completed.add(st.id);
    this.go(this.index + 1);
  }

  back(): void {
    if (this.status !== 'running') return;
    let i = this.index - 1;
    while (i > 0 && this.skipped.has(this.def.steps[i]!.id)) i--;
    if (i >= 0) this.go(i);
  }

  /** Do the step's action for the player and move on. */
  skipStep(): void {
    const st = this.step;
    if (this.status !== 'running' || !st || this.flashing || st.noSkip) return;
    st.auto?.(this.ctx);
    this.completed.add(st.id);
    this.go(this.index + 1);
  }

  private onCommand(cmd: Command): void {
    const h = this.host;
    if (!h) return;
    this.cmds.push({ t: h.battle.time, cmd });
    // A move right after a line preview was on screen: a right-drag.
    if (cmd.type === 'move' && this.now - this.previewAt < 300) this.lineOrders++;
    this.bump();
  }

  private go(i: number): void {
    const h = this.host;
    if (!h) return;
    this.release();
    this.flashUntil = 0;
    const steps = this.def.steps;
    i = Math.max(0, Math.min(steps.length - 1, i));
    this.index = i;
    const st = steps[i]!;
    const first = !this.entered.has(st.id);
    if (first) {
      this.entered.add(st.id);
      if (st.skip?.(this.ctx) && i < steps.length - 1) {
        this.skipped.add(st.id);
        this.completed.add(st.id);
        this.go(i + 1);
        return;
      }
      st.enter?.(this.ctx);
    }
    if (st.pause && !this.completed.has(st.id) && !h.paused && h.phase === 'battle') {
      if (h.battle.tick > 0) {
        h.paused = true;
        this.holding = true;
      } else this.pausePending = true;
    }
    this.stepStart = h.battle.time;
    this.stepCmd = this.cmds.length;
    if (first) {
      const v = resolve(st.view, this.ctx);
      if (v) this.onView?.(v);
    }
    this.bump();
  }

  /** Let go of a pause this tutorial asked for. */
  private release(): void {
    this.pausePending = false;
    const h = this.host;
    if (h && this.holding && h.paused) h.paused = false;
    this.holding = false;
  }

  private finish(): void {
    const h = this.host!;
    this.release();
    this.flashUntil = 0;
    const r = h.battle.result;
    this.status = r && r.winner === h.side ? 'won' : 'lost';
    if (this.status === 'won') markComplete(this.def.id);
    this.bump();
  }

  bump(): void {
    this.version.value++;
  }
}
