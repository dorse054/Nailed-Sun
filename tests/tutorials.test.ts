/**
 * The tutorials, played headless: every step's own "Skip step" action drives
 * the battle, and each lesson's key effect must really happen in the sim.
 */
import { describe, expect, it } from 'vitest';
import { Battle } from '../src/sim/battle';
import { BattleAI } from '../src/ai/battleAI';
import { effectiveRange, weaponOf } from '../src/sim/missiles';
import { TOLL } from '../src/data/rules';
import type { HourId } from '../src/data/schema';
import type { Command, Side, SimEvent, Unit } from '../src/sim/types';
import { TUTORIALS, tutorialDef, tutorialRequest } from '../src/app/tutorial/index';
import type { TutorialRun } from '../src/app/tutorial/runner';
import type { TutorialHost } from '../src/app/tutorial/types';

class HeadlessHost implements TutorialHost {
  readonly battle: Battle;
  readonly side: Side = 0;
  phase: 'deploy' | 'battle' | 'over' = 'battle';
  paused = false;
  speed = 1;
  readonly overlay = { selected: new Set<number>(), preview: [] as unknown[] };
  onIssue: ((cmd: Command) => void) | null = null;
  readonly events: SimEvent[] = [];

  constructor(run: ReturnType<typeof tutorialRequest>) {
    this.battle = new Battle(run.req.setup, { events: true });
    for (const s of [0, 1] as Side[]) {
      const c = run.req.controller?.(s);
      if (c) this.battle.setController(s, c);
    }
  }

  select(ids: number[], add = false): void {
    if (!add) this.overlay.selected.clear();
    for (const id of ids) if (this.battle.units[id]?.side === this.side) this.overlay.selected.add(id);
  }

  issue(cmd: Command): void {
    if (this.phase !== 'battle') return;
    this.battle.issue(this.side, cmd);
    this.onIssue?.(cmd);
  }

  setHour(hour: HourId): void {
    this.issue({ type: 'hour', side: this.side, hour });
  }

  tick(): void {
    if (this.phase !== 'battle' || this.paused) return;
    this.battle.step();
    this.events.push(...this.battle.takeEvents());
    if (this.battle.over) this.phase = 'over';
  }
}

interface Played {
  run: TutorialRun;
  host: HeadlessHost;
  /** Sim time each step was reached. */
  reached: Map<string, number>;
}

/**
 * Play a tutorial: Next on text steps, each action step's own action once,
 * then the battle AI takes over for the player at the last step.
 */
function play(id: string, watch?: (p: Played) => void): Played {
  const def = tutorialDef(id)!;
  const made = tutorialRequest(def);
  const host = new HeadlessHost(made);
  const run = made.run;
  const p: Played = { run, host, reached: new Map() };
  run.attach(host, 0);
  const acted = new Set<string>();
  let ms = 0;
  for (let i = 0; i < 20 * 900 && run.status === 'running'; i++) {
    const st = run.step!;
    if (!p.reached.has(st.id)) p.reached.set(st.id, host.battle.time);
    if (run.index === run.total - 1 && !acted.has('ai')) {
      acted.add('ai');
      host.battle.setController(0, new BattleAI());
    }
    if (run.waitsForNext && !run.flashing) run.next();
    else if (!run.flashing && !acted.has(st.id)) {
      acted.add(st.id);
      st.auto?.(run.ctx);
    }
    host.tick();
    ms += 50;
    run.update(ms);
    watch?.(p);
  }
  return p;
}

describe('tutorials', () => {
  it('has one tutorial per faction, each with a fixed setup and unique step ids', () => {
    expect(TUTORIALS.map((t) => t.faction).sort()).toEqual(['choir', 'drift', 'hush', 'vesperate']);
    for (const t of TUTORIALS) {
      const ids = t.steps.map((s) => s.id);
      expect(new Set(ids).size, t.id).toBe(ids.length);
      expect(JSON.stringify(t.setup()), t.id).toBe(JSON.stringify(t.setup()));
      const tags = t.setup().armies.flatMap((a) => a.units.map((u) => u.tag));
      expect(new Set(tags).size, `${t.id} tags`).toBe(tags.length);
      expect(t.steps.at(-1)!.done, `${t.id} ends on the battle`).toBeTypeOf('function');
    }
  });

  it('holds the enemy still until the lesson lets it fight', () => {
    const def = tutorialDef('choir')!;
    const made = tutorialRequest(def);
    const host = new HeadlessHost(made);
    const start = host.battle.units.filter((u) => u.side === 1).map((u) => [u.x, u.y]);
    for (let i = 0; i < 20 * 30; i++) host.tick();
    const moved = host.battle.units.filter((u) => u.side === 1).map((u, k) => Math.hypot(u.x - start[k]![0]!, u.y - start[k]![1]!));
    expect(Math.max(...moved)).toBeLessThan(1);
  });

  it('pauses for reading and resumes when the step ends', () => {
    const def = tutorialDef('choir')!;
    const made = tutorialRequest(def);
    const host = new HeadlessHost(made);
    const run = made.run;
    run.attach(host, 0);
    host.tick();
    run.update(50);
    expect(run.step!.id).toBe('welcome');
    expect(host.paused).toBe(true);
    run.next();
    run.next();
    run.next();
    expect(run.step!.id).toBe('select');
    expect(host.paused).toBe(false);
  });

  it('Choir: the enemy marches into the glare, and Sunpatch lights the Lenswrights', () => {
    let glaredAtContact = -1;
    let lensLight = 0;
    const p = play('choir', ({ run, host }) => {
      const c = run.ctx;
      if (run.step?.id === 'attack' && glaredAtContact < 0) glaredAtContact = c.glared().length;
      lensLight = Math.max(lensLight, c.unit('lens')?.light ?? 0);
      void host;
    });
    expect(p.run.status).toBe('won');
    expect(p.run.completed.size).toBe(p.run.total - 1);
    expect(glaredAtContact).toBeGreaterThanOrEqual(2);
    expect(lensLight).toBe(3);
    // The Choir themselves never suffer glare.
    expect(p.host.battle.units.filter((u) => u.side === 0).every((u) => u.stats.glareAcc === 0)).toBe(true);
  });

  it('Hush: The Unlit stay unseen on the way to the ambush, then strike from hiding', () => {
    let seenOnTheWay = false;
    const p = play('hush', ({ run }) => {
      const c = run.ctx;
      const u = c.unit('unlit')!;
      if ((run.step?.id === 'flank' || run.step?.id === 'lure') && c.time > 3 && u.visible[1]) seenOnTheWay = true;
    });
    expect(p.run.status).toBe('won');
    expect(seenOnTheWay).toBe(false);
    const feared = p.host.battle.units.some((u) => u.side === 1 && u.special.feared);
    expect(feared).toBe(true);
  });

  it('Vesperate: Call the Hour lands the Antlered Lancers charge on the bell', () => {
    let onBell = false;
    const p = play('vesperate', ({ run }) => {
      const l = run.ctx.unit('lancers')!;
      if (l.chargeStart > 0 && l.chargeStart < l.tollUntil && l.chargeStart >= l.tollUntil - TOLL.window) onBell = true;
    });
    expect(p.run.status).toBe('won');
    expect(onBell).toBe(true);
    expect(p.host.events.some((e) => e.t === 'text' && e.text === 'Charge on the bell!')).toBe(true);
    // The line fought through a Toll on the Hour of Iron.
    expect(p.reached.get('chargeHour')).toBeGreaterThan(p.reached.get('hold')!);
  });

  it('Drift: the Firekite Battery cannot reach from the start, but can from upwind', () => {
    const reach = (from: Unit, to: Unit, b: Battle) => {
      const w = weaponOf(from)!;
      const dir = Math.atan2(to.y - from.y, to.x - from.x);
      return { d: Math.hypot(to.x - from.x, to.y - from.y), r: effectiveRange(b, from, w, dir) };
    };
    let atStart: { d: number; r: number } | null = null;
    let atSpot: { d: number; r: number } | null = null;
    const p = play('drift', ({ run, host }) => {
      const c = run.ctx;
      const kites = c.unit('kites')!;
      const arbs = c.unit('arbs')!;
      if (!atStart && host.battle.tick === 1) atStart = reach(kites, arbs, host.battle);
      if (!atSpot && run.step?.id === 'fire') atSpot = reach(kites, arbs, host.battle);
    });
    expect(p.run.status).toBe('won');
    expect(atStart!.d).toBeGreaterThan(atStart!.r + 8);
    expect(atSpot!.d).toBeLessThan(atSpot!.r);
    // Downwind reach in a Gale is more than double the reach into the wind.
    const b = p.host.battle;
    const kites = p.run.ctx.unit('kites')!;
    const w = weaponOf(kites)!;
    expect(effectiveRange(b, kites, w, 0)).toBeGreaterThan(2 * effectiveRange(b, kites, w, Math.PI));
  });
});
