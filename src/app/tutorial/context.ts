/**
 * What a tutorial step sees: the battle, the player's selection and orders,
 * plus helpers to find units by tag and to act for the player (Skip step).
 */
import type { HourId } from '../../data/schema';
import type { AIOptions } from '../../ai/battleAI';
import type { Battle } from '../../sim/battle';
import type { Command, Unit } from '../../sim/types';
import type { TutorialEnemy } from './enemy';
import type { Spot, TutorialHost } from './types';

/** The runner's state a context reads. */
export interface RunState {
  readonly host: TutorialHost | null;
  readonly enemy: TutorialEnemy;
  readonly touch: boolean;
  /** Sim time when the current step started. */
  readonly stepStart: number;
  /** Index into `cmds` where the current step started. */
  readonly stepCmd: number;
  readonly cmds: readonly { t: number; cmd: Command }[];
  /** Right-drag line orders given so far. */
  readonly lineOrders: number;
}

export class TutorialContext {
  /** Scratch memory for steps that need to remember something. */
  readonly mem: Record<string, number | undefined> = {};

  constructor(private readonly run: RunState) {}

  get s(): TutorialHost {
    return this.run.host!;
  }

  get b(): Battle {
    return this.run.host!.battle;
  }

  get time(): number {
    return this.b.time;
  }

  get touch(): boolean {
    return this.run.touch;
  }

  /** Seconds of battle since the current step started. */
  get elapsed(): number {
    return this.b.time - this.run.stepStart;
  }

  get lineOrders(): number {
    return this.run.lineOrders;
  }

  /** "Click" or "Tap", for the player's device. */
  get click(): string {
    return this.run.touch ? 'Tap' : 'Click';
  }

  /** "Right-click" or "Tap", for orders. */
  get order(): string {
    return this.run.touch ? 'Tap' : 'Right-click';
  }

  // ---------------------------------------------------------------- units

  unit(tag: string): Unit | undefined {
    return this.b.units.find((u) => u.tag === tag);
  }

  /** In the fight: alive and under orders. */
  ready(tag: string): boolean {
    const u = this.unit(tag);
    return !!u && u.alive > 0 && u.state === 'ready';
  }

  isSelected(tag: string): boolean {
    const u = this.unit(tag);
    return !!u && this.s.overlay.selected.has(u.id);
  }

  /** The unit stands within a spot (its center). */
  inSpot(tag: string, p: Spot): boolean {
    const u = this.unit(tag);
    return !!u && u.alive > 0 && Math.hypot(u.x - p.x, u.y - p.y) <= p.r;
  }

  dist(a: Unit | undefined, b: Unit | undefined): number {
    if (!a || !b) return Infinity;
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  /** Enemy units still fighting. */
  foes(): Unit[] {
    const side = this.s.side;
    return this.b.units.filter((u) => u.side !== side && u.alive > 0 && u.state === 'ready');
  }

  /** Enemy units the player can see. */
  seenFoes(): Unit[] {
    const side = this.s.side;
    return this.foes().filter((u) => u.visible[side]);
  }

  /** Visible enemy units suffering glare right now. */
  glared(): Unit[] {
    return this.seenFoes().filter((u) => u.stats.glareAcc < 0);
  }

  /** The enemy unit in melee with one of ours, if any. */
  foeFighting(tag: string): Unit | undefined {
    const u = this.unit(tag);
    if (!u) return undefined;
    return this.foes().find((e) => e.engaged > 0 && (e.meleeTarget === u || u.meleeTarget === e));
  }

  /** Orders the player gave during the current step. */
  orders(): Command[] {
    return this.run.cmds.slice(this.run.stepCmd).map((c) => c.cmd);
  }

  /** The player ordered this unit to attack during the current step. */
  attacked(tag: string): Unit | undefined {
    const u = this.unit(tag);
    if (!u) return undefined;
    for (const c of this.orders()) {
      if (c.type === 'attack' && c.unit === u.id) return this.b.units[c.target];
    }
    return undefined;
  }

  /** The player used this ability during the current step. */
  used(ability: string): boolean {
    return this.orders().some((c) => c.type === 'ability' && c.ability === ability);
  }

  // --------------------------------------------------------------- enemy

  /** Let the opponent fight (it stands still until then). */
  enemyFight(opts: AIOptions = {}): void {
    this.run.enemy.fight(opts);
  }

  // -------------------------------------------- acting for the player

  select(...tags: string[]): void {
    const ids = tags.map((t) => this.unit(t)?.id).filter((id): id is number => id !== undefined);
    this.s.select(ids);
  }

  move(tag: string, x: number, y: number, facing?: number): void {
    const u = this.unit(tag);
    if (u) this.s.issue({ type: 'move', unit: u.id, x, y, facing, run: u.running });
  }

  attack(tag: string, target: Unit | undefined): void {
    const u = this.unit(tag);
    if (u && target) this.s.issue({ type: 'attack', unit: u.id, target: target.id, run: true });
  }

  cast(tag: string, ability: string, at?: { x: number; y: number }, target?: Unit): void {
    const u = this.unit(tag);
    if (u) this.s.issue({ type: 'ability', unit: u.id, ability, x: at?.x, y: at?.y, target: target?.id });
  }

  hour(h: HourId): void {
    this.s.setHour(h);
  }

  // ------------------------------------------------- HUD selectors

  /** The unit's card along the bottom of the screen. */
  card(tag: string): string {
    const u = this.unit(tag);
    return u ? `.card[data-unit="${u.id}"]` : '';
  }

  ability(id: string): string {
    return `[data-ability="${id}"]`;
  }
}
