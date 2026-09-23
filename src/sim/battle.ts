/**
 * A battle: a fixed 20-tick-per-second simulation with seeded randomness, so
 * the same seed and the same orders replay the same battle exactly. It knows
 * nothing about graphics; on-screen battles, auto-resolve and the balance
 * simulator all run this same code.
 */
import type { FactionId, HourId, MissileWeapon } from '../data/schema';
import { factionDef, unitDef } from '../data/index';
import { MORALE } from '../data/rules';
import { Rng } from '../core/rng';
import { SpatialHash } from '../core/spatial';
import { datan2, dcos, dsin, HALF_PI } from '../core/dmath';
import { Terrain } from './terrain';
import { NavGrid } from './pathfind';
import { DT } from './constants';
import type {
  BattleResult,
  BattleSetup,
  Command,
  Projectile,
  Side,
  SideSummary,
  SimEvent,
  Soldier,
  Telegraph,
  TimedCommand,
  Unit,
  Zone,
} from './types';
import { autoDeploy, createUnit, layoutSlots, placeInFormation, unitHpShare } from './army';
import { computeStats } from './stats';
import { addZone } from './zones';
import { updateZones } from './zones';
import { updateToll } from './toll';
import { castAbility } from './abilities';
import { updateAbilities } from './abilities';
import { updateSpecials } from './specials';
import { moveSoldiers, resolveCollisions, setMoveOrder, settleSoldiers, updateAnchors } from './movement';
import { updateMelee, updateStatus } from './melee';
import { effectiveRange as effRange, updateMissileUnits, updateProjectiles, weaponOf as missileWeaponOf } from './missiles';
import { updateMorale } from './morale';
import { updateVisibility } from './visibility';
import { hasMechanic, mechanic } from './mechanics';
import { applyDamage } from './combat';

export interface SideState {
  faction: FactionId;
  controller: 'player' | 'ai';
  hour: HourId;
  tollTimer: number;
  tollInterval: number;
  lastToll: number;
  general: Unit | null;
  generalDead: boolean;
  /** Seconds the attacker has held the capture point uncontested. */
  capture: number;
}

/** Anything that plays a side: the scripted AI, a tutorial script, a replay. */
export interface Controller {
  update(b: Battle, side: Side): void;
}

/** Collects events only when someone is listening (renderer, audio, tests). */
export class EventSink {
  list: SimEvent[] = [];
  constructor(public on: boolean) {}
  push(e: SimEvent): void {
    if (this.on) this.list.push(e);
  }
}

export class Battle {
  readonly setup: BattleSetup;
  readonly terrain: Terrain;
  readonly nav: NavGrid;
  readonly rng: Rng;
  readonly aiRng: Rng;
  tick = 0;
  time = 0;
  readonly units: Unit[] = [];
  readonly soldiers: Soldier[] = [];
  readonly bigSoldiers: Soldier[] = [];
  zones: Zone[] = [];
  projectiles: Projectile[] = [];
  telegraphs: Telegraph[] = [];
  readonly events: EventSink;
  readonly sides: [SideState, SideState];
  readonly controllers: [Controller | null, Controller | null] = [null, null];
  /** Orders as applied, by tick: the replay log. */
  readonly log: TimedCommand[] = [];
  private queue: { side: Side; cmd: Command; record: boolean }[] = [];
  private replay: TimedCommand[] | null = null;
  private replayIdx = 0;
  readonly hash: SpatialHash;
  visited: Uint32Array;
  private stampVal = 1;
  result: BattleResult | null = null;
  nextZoneId = 1;
  nextProjectileId = 1;
  nextTelegraphId = 1;
  windBonus = 0;
  readonly ramHits = new Map<number, Set<number>>();
  readonly timeLimit: number;

  constructor(setup: BattleSetup, opts: { events?: boolean; replay?: TimedCommand[] } = {}) {
    this.setup = setup;
    this.terrain = new Terrain(setup.map);
    this.nav = new NavGrid(this.terrain);
    this.rng = new Rng(`battle:${setup.seed}`);
    this.aiRng = new Rng(`ai:${setup.seed}`);
    this.events = new EventSink(opts.events ?? false);
    this.replay = opts.replay ?? null;
    this.timeLimit = setup.timeLimit ?? 20 * 60;
    this.sides = [0, 1].map((side) => {
      const army = setup.armies[side]!;
      return {
        faction: army.faction,
        controller: army.controller,
        hour: army.hour ?? 'charge',
        tollTimer: 0,
        tollInterval: Infinity,
        lastToll: -999,
        general: null,
        generalDead: false,
        capture: 0,
      } satisfies SideState;
    }) as [SideState, SideState];
    const scale = setup.unitScale ?? 1;
    for (const side of [0, 1] as const) {
      const army = setup.armies[side];
      const placed: Unit[] = [];
      const unplaced: Unit[] = [];
      for (const spec of army.units) {
        const def = unitDef(spec.def);
        const u = createUnit(this.units.length, def, side, spec, scale);
        this.addUnit(u);
        if (spec.x !== undefined && spec.y !== undefined) placed.push(u);
        else unplaced.push(u);
      }
      if (unplaced.length) autoDeploy(unplaced, side, this.terrain);
      for (const u of placed) placeInFormation(u);
      const lord = this.units.find((u) => u.side === side && u.def.character?.kind === 'lord');
      this.sides[side].general = lord ?? null;
      for (const u of this.units) if (u.side === side) u.isGeneral = u === lord;
    }
    this.hash = new SpatialHash(this.terrain.width, this.terrain.height, 4, this.soldiers.length + 16);
    this.visited = new Uint32Array(this.soldiers.length + 16);
    // Nobody starts inside a building, a cliff or deep water.
    for (const u of this.units) settleSoldiers(this, u);
    for (const u of this.units) this.attachMechanicZones(u);
    for (const u of this.units) {
      computeStats(this, u);
      u.morale = u.maxMorale;
    }
    this.rebuildHash();
    // Everyone starts knowing where the other army deployed.
    for (const u of this.units) {
      u.visible = [true, true];
      u.lastSeen = [0, 0];
    }
    updateVisibility(this);
  }

  private addUnit(u: Unit): void {
    this.units.push(u);
    for (const s of u.soldiers) {
      s.id = this.soldiers.length;
      this.soldiers.push(s);
      if (s.radius > 1.3) this.bigSoldiers.push(s);
    }
  }

  private attachMechanicZones(u: Unit): void {
    for (const m of u.def.mechanics ?? []) {
      if (m.kind === 'zone') addZone(this, m.zone, u.side, u.x, u.y, Infinity, u, true);
    }
  }

  setController(side: Side, c: Controller | null): void {
    this.controllers[side] = c;
  }

  /** Queue an order; it takes effect at the start of the next tick. */
  issue(side: Side, cmd: Command, record = true): void {
    this.queue.push({ side, cmd, record });
  }

  get over(): boolean {
    return this.result !== null;
  }

  takeEvents(): SimEvent[] {
    const l = this.events.list;
    this.events.list = [];
    return l;
  }

  visitStamp(): number {
    this.stampVal++;
    if (this.stampVal > 4e9) {
      this.stampVal = 1;
      this.visited.fill(0);
    }
    return this.stampVal;
  }

  rebuildHash(): void {
    const h = this.hash;
    h.clear();
    const ss = this.soldiers;
    for (let i = 0; i < ss.length; i++) {
      const s = ss[i]!;
      if (s.alive && s.unit.state !== 'embarked') h.insert(i, s.x, s.y);
    }
  }

  /** Advance one tick (1/20 s). */
  step(): void {
    if (this.result) return;
    this.tick++;
    this.time = this.tick * DT;
    this.applyOrders();
    for (const side of [0, 1] as const) {
      const c = this.controllers[side];
      if (c && this.tick % 10 === side * 5) c.update(this, side);
    }
    updateZones(this);
    for (const u of this.units) {
      if (u.alive > 0 && u.state !== 'dead' && u.state !== 'fled') computeStats(this, u);
      if (u.chill > 0) u.chill -= DT;
      if (u.slow > 0) u.slow -= DT;
      if (u.grounded > 0) u.grounded -= DT;
      if (u.marked > 0) u.marked -= DT;
    }
    updateToll(this);
    updateAbilities(this);
    updateSpecials(this);
    updateAnchors(this);
    this.rebuildHash();
    updateMelee(this);
    moveSoldiers(this);
    this.rebuildHash();
    resolveCollisions(this);
    updateMissileUnits(this);
    updateProjectiles(this);
    updateStatus(this);
    updateMorale(this);
    updateVisibility(this);
    if (this.tick % 20 === 0) {
      this.siegeTick();
      this.checkVictory();
    }
  }

  /** Run headless until the battle ends or a tick budget runs out. */
  run(maxSeconds = this.timeLimit + 5): BattleResult {
    const maxTicks = Math.ceil(maxSeconds / DT);
    while (!this.result && this.tick < maxTicks) this.step();
    if (!this.result) this.finish(this.timeoutWinner(), 'timeout');
    return this.result!;
  }

  private applyOrders(): void {
    // Queued orders first. Controllers issue theirs during the previous tick and the player issues
    // between ticks, so in the recorded battle a tick's logged orders always came after the
    // controllers' ones; a replay applies its log entries after the queue to keep that order.
    if (this.queue.length) {
      const q = this.queue;
      this.queue = [];
      for (const { side, cmd, record } of q) {
        if (record && !this.replay) this.log.push({ tick: this.tick, side, cmd });
        this.applyCommand(side, cmd);
      }
    }
    if (this.replay) {
      while (this.replayIdx < this.replay.length && this.replay[this.replayIdx]!.tick <= this.tick) {
        const c = this.replay[this.replayIdx++]!;
        this.applyCommand(c.side, c.cmd);
      }
    }
  }

  private applyCommand(side: Side, cmd: Command): void {
    if (cmd.type === 'hour') {
      if (this.sides[side].faction === 'vesperate') this.sides[side].hour = cmd.hour;
      return;
    }
    const u = this.units[cmd.unit];
    if (!u || u.side !== side) return;
    if (u.state !== 'ready' && !(u.state === 'embarked' && cmd.type === 'disembark')) {
      if (!(u.state === 'embarked' && (cmd.type === 'fireAtWill' || cmd.type === 'attack'))) return;
    }
    switch (cmd.type) {
      case 'move': {
        this.leaveImmobileStance(u);
        const facing = cmd.facing ?? datan2(cmd.y - u.y, cmd.x - u.x);
        setMoveOrder(this, u, cmd.x, cmd.y, facing, cmd.files ?? u.files, cmd.run ?? u.running);
        u.missileTarget = null;
        break;
      }
      case 'attack': {
        const t = this.units[cmd.target];
        if (!t || t.side === side || t.alive <= 0) return;
        if (u.state === 'embarked') {
          u.missileTarget = t;
          return;
        }
        this.leaveImmobileStance(u);
        u.order = { kind: 'attack', target: t.id, run: cmd.run ?? true };
        u.running = cmd.run ?? true;
        u.path = [];
        u.withdrawing = false;
        u.special.stealthCharge = u.concealed ? 1 : 0;
        if (missileWeaponOf(u) && !u.special.meleeMode) u.missileTarget = t;
        break;
      }
      case 'halt':
        u.order = { kind: 'hold' };
        u.path = [];
        u.meleeTarget = null;
        u.missileTarget = null;
        break;
      case 'run':
        u.running = cmd.on;
        if (u.order.kind === 'move') u.order.run = cmd.on;
        break;
      case 'fireAtWill':
        u.fireAtWill = cmd.on;
        break;
      case 'meleeMode':
        u.special.meleeMode = cmd.on ? 1 : 0;
        if (cmd.on) u.missileTarget = null;
        break;
      case 'ability':
        castAbility(this, u, cmd.ability, cmd.x, cmd.y, cmd.target);
        break;
      case 'embark': {
        const car = this.units[cmd.target];
        if (!car || car.side !== side || !this.canEmbark(u, car)) return;
        u.order = { kind: 'embark', target: car.id };
        break;
      }
      case 'disembark':
        if (u.state === 'embarked') this.disembark(u, false);
        break;
      case 'withdraw': {
        const y = side === 0 ? this.terrain.height + 30 : -30;
        setMoveOrder(this, u, u.x, y, side === 0 ? HALF_PI : -HALF_PI, u.files, true);
        u.order = { kind: 'move', x: u.x, y: side === 0 ? this.terrain.height - 2 : 2, facing: side === 0 ? HALF_PI : -HALF_PI, files: u.files, run: true };
        u.special.withdrawn = 1;
        break;
      }
    }
  }

  /** Orders to move end an immobile stance (Set the Dial, Drop Anchor). */
  private leaveImmobileStance(u: Unit): void {
    for (const a of u.abilities) {
      if (a.def.kind === 'toggle' && a.on && a.def.stance?.immobile) castAbility(this, u, a.def.id);
    }
  }

  // ------------------------------------------------------------ helpers used by systems

  weaponOf(u: Unit): MissileWeapon | undefined {
    return missileWeaponOf(u);
  }

  effectiveRange(u: Unit, w: MissileWeapon, dir: number): number {
    return effRange(this, u, w, dir);
  }

  defaultReach(u: Unit): number {
    switch (u.def.category) {
      case 'infantry':
        return 1;
      case 'cavalry':
        return 1.4;
      case 'beast':
        return 1;
      case 'monster':
        return 2.5;
      case 'colossus':
        return 6;
      case 'character':
        return 1.3;
      case 'artillery':
        return 0.8;
      case 'flyer':
        return 1.3;
    }
  }

  soldierFled(s: Soldier): void {
    if (!s.alive) return;
    const u = s.unit;
    s.alive = false;
    s.target = null;
    u.alive--;
    u.slotsDirty = true;
    if (u.alive <= 0) {
      u.alive = 0;
      u.state = 'fled';
    }
  }

  generalDied(side: Side, s: Soldier): void {
    const st = this.sides[side];
    if (st.generalDead) return;
    st.generalDead = true;
    this.events.push({ t: 'general', side });
    this.events.push({ t: 'text', x: s.x, y: s.y, text: 'The general has fallen!', side });
    for (const u of this.units) {
      if (u.side !== side || u.state !== 'ready' || u.stats.fearImmune) continue;
      u.morale -= (MORALE.generalDeadShock / 100) * u.maxMorale;
    }
  }

  colossusFell(u: Unit): void {
    const s = u.soldiers[0]!;
    this.events.push({ t: 'shockwave', x: s.x, y: s.y, r: 60, kind: 'dust' });
    this.events.push({ t: 'text', x: s.x, y: s.y, text: `${u.def.name} has fallen!`, side: u.side });
    for (const o of this.units) {
      if (o.state !== 'ready') continue;
      const d2 = (o.x - s.x) * (o.x - s.x) + (o.y - s.y) * (o.y - s.y);
      if (d2 > 250 * 250) continue;
      if (o.side === u.side) {
        if (!o.stats.fearImmune) o.morale -= 0.12 * o.maxMorale;
      } else o.morale = Math.min(o.maxMorale, o.morale + 0.12 * o.maxMorale);
    }
  }

  canEmbark(u: Unit, car: Unit): boolean {
    if (u.def.role !== 'missile' || u.def.category !== 'infantry') return false;
    const g = mechanic(car.def, 'garrison');
    if (g) return car.passengers.length < g.slots;
    if (hasMechanic(car.def, 'carrier')) return car.passengers.length < 1 && u.def.id === 'drift.windbows';
    return false;
  }

  embark(u: Unit, car: Unit): void {
    if (!this.canEmbark(u, car)) {
      u.order = { kind: 'hold' };
      return;
    }
    u.state = 'embarked';
    u.embarkedOn = car;
    car.passengers.push(u);
    u.order = { kind: 'hold' };
    u.meleeTarget = null;
    for (const s of u.soldiers) {
      s.target = null;
      s.approach = null;
    }
    this.events.push({ t: 'text', x: car.x, y: car.y, text: `${u.def.name} embarked`, side: u.side });
  }

  disembark(u: Unit, forced: boolean): void {
    const car = u.embarkedOn;
    if (!car) return;
    car.passengers = car.passengers.filter((p) => p !== u);
    u.embarkedOn = null;
    u.state = 'ready';
    const hull = car.soldiers.find((s) => s.alive) ?? car.soldiers[0]!;
    u.x = hull.x - dcos(car.facing) * (hull.radius + 8);
    u.y = hull.y - dsin(car.facing) * (hull.radius + 8);
    u.facing = car.facing;
    u.order = { kind: 'hold' };
    layoutSlots(u);
    placeInFormation(u);
    settleSoldiers(this, u);
    if (forced) {
      // Thrown from a falling tower or ship.
      for (const s of u.soldiers) if (s.alive && this.rng.next() < 0.3) applyDamage(this, s, s.hp, null, 'normal', null);
      u.morale -= 0.3 * u.maxMorale;
    }
  }

  /** The Dreadsail rams walls and gates down in fortified battles. */
  ramWalls(_u: Unit, x: number, y: number, reach: number, speed: number): void {
    let changed = false;
    for (const w of this.terrain.walls) {
      if (w.broken || w.tower) continue;
      const mx = (w.x1 + w.x2) / 2;
      const my = (w.y1 + w.y2) / 2;
      const d2 = (mx - x) * (mx - x) + (my - y) * (my - y);
      if (d2 > (reach + 25) * (reach + 25)) continue;
      w.hp -= 60 * speed;
      if (w.hp <= 0) {
        w.broken = true;
        changed = true;
        this.events.push({ t: 'shockwave', x: mx, y: my, r: 30, kind: 'dust' });
        this.events.push({ t: 'text', x: mx, y: my, text: w.gate ? 'Gate broken!' : 'Wall breached!', side: _u.side });
      }
    }
    if (changed) {
      this.terrain.stampWalls();
      this.nav.rebuild();
    }
  }

  /** Attackers at a gate batter it down; large creatures hit harder. */
  private siegeTick(): void {
    const f = this.terrain.fort;
    if (!f) return;
    const atk = (1 - f.defender) as Side;
    for (const w of this.terrain.walls) {
      if (w.broken || w.tower || !w.gate) continue;
      const mx = (w.x1 + w.x2) / 2;
      const my = (w.y1 + w.y2) / 2;
      let dmg = 0;
      for (const u of this.units) {
        if (u.side !== atk || u.state !== 'ready' || u.alive <= 0) continue;
        const cat = u.def.category;
        if (cat === 'artillery' || cat === 'flyer') continue;
        const d2 = (u.x - mx) * (u.x - mx) + (u.y - my) * (u.y - my);
        if (d2 > 26 * 26) continue;
        const heavy = cat === 'monster' || cat === 'colossus' || u.def.size !== 'small';
        dmg += Math.min(u.alive, 40) * u.def.weapon.base * 0.05 * (heavy ? 3 : 1);
      }
      if (dmg > 0) this.hurtWall(w, dmg, atk);
    }
    if (this.wallsChanged) {
      this.wallsChanged = false;
      this.terrain.stampWalls();
      this.nav.rebuild();
    }
  }

  private wallsChanged = false;

  private hurtWall(w: Terrain['walls'][number], dmg: number, side: Side): void {
    w.hp -= dmg;
    if (w.hp > 0) return;
    w.broken = true;
    this.wallsChanged = true;
    const mx = (w.x1 + w.x2) / 2;
    const my = (w.y1 + w.y2) / 2;
    this.events.push({ t: 'shockwave', x: mx, y: my, r: 30, kind: 'dust' });
    this.events.push({ t: 'text', x: mx, y: my, text: w.gate ? 'Gate broken!' : 'Wall breached!', side });
  }

  /** Engines and beams damage walls and gates near a point. */
  damageWalls(x: number, y: number, r: number, dmg: number, side: Side, gatesOnly = false): void {
    if (!this.terrain.fort || dmg <= 0) return;
    for (const w of this.terrain.walls) {
      if (w.broken || w.tower || (gatesOnly && !w.gate)) continue;
      const dx = w.x2 - w.x1;
      const dy = w.y2 - w.y1;
      const l2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((x - w.x1) * dx + (y - w.y1) * dy) / l2));
      const px = w.x1 + dx * t - x;
      const py = w.y1 + dy * t - y;
      if (px * px + py * py > (r + 4) * (r + 4)) continue;
      this.hurtWall(w, dmg, side);
    }
    if (this.wallsChanged) {
      this.wallsChanged = false;
      this.terrain.stampWalls();
      this.nav.rebuild();
    }
  }

  // ----------------------------------------------------------------- victory

  /**
   * A side is still in the fight while it has an active unit. An army reduced
   * to characters, support and artillery at under 15% of its value withdraws.
   */
  private sideActive(side: Side): boolean {
    let any = false;
    let fighting = false;
    for (const u of this.units) {
      if (u.side !== side || u.alive <= 0) continue;
      if (u.state === 'ready' || u.state === 'embarked') {
        if (u.special.withdrawn) continue;
        any = true;
        const r = u.def.role;
        if (r !== 'hero' && r !== 'lord' && r !== 'support' && r !== 'artillery') fighting = true;
      }
    }
    if (!any) return false;
    if (!fighting && this.remainingValue(side) < 0.15) return false;
    return true;
  }

  /**
   * An army is broken when what it still has standing is a small remnant of what
   * it brought and the enemy holds the field with far more: it leaves the field
   * instead of letting a lord, a battery or a hidden unit drag the battle out.
   */
  private sideBroken(side: Side): boolean {
    const mine = this.remainingValue(side);
    if (mine >= VICTORY.brokenBelow) return false;
    const theirs = this.remainingValue((1 - side) as Side);
    return theirs >= mine * VICTORY.brokenRatio + VICTORY.brokenMargin;
  }

  private checkVictory(): void {
    const a0 = this.sideActive(0);
    const a1 = this.sideActive(1);
    if (!a0 && !a1) return this.finish(-1, 'rout');
    if (!a0) return this.finish(1, 'rout');
    if (!a1) return this.finish(0, 'rout');
    const cp = this.terrain.capturePoint;
    if (cp && this.terrain.fort) {
      const def = this.terrain.fort.defender;
      const atk = (1 - def) as Side;
      let atkIn = false;
      let defIn = false;
      for (const u of this.units) {
        if (u.state !== 'ready' || u.alive <= 0) continue;
        const d2 = (u.x - cp.x) * (u.x - cp.x) + (u.y - cp.y) * (u.y - cp.y);
        if (d2 > (cp.r + 10) * (cp.r + 10)) continue;
        if (u.side === atk) atkIn = true;
        else defIn = true;
      }
      const st = this.sides[atk];
      if (atkIn && !defIn) st.capture += 1;
      else if (!atkIn) st.capture = Math.max(0, st.capture - 1);
      if (st.capture >= 60) return this.finish(atk, 'capture');
      // An assault that has spent itself against the walls is called off. (The defender
      // holds its walls to the last: the attacker must still take the point.)
      if (this.sideBroken(atk)) return this.finish(def, 'rout');
    } else {
      // Field battles only: a fortified defender holds its walls to the last.
      const b0 = this.sideBroken(0);
      const b1 = this.sideBroken(1);
      if (b0 !== b1) return this.finish(b0 ? 1 : 0, 'rout');
    }
    if (this.time >= this.timeLimit) this.finish(this.timeoutWinner(), 'timeout');
  }

  private timeoutWinner(): Side | -1 {
    if (this.terrain.fort) return this.terrain.fort.defender;
    const v0 = this.remainingValue(0);
    const v1 = this.remainingValue(1);
    if (Math.abs(v0 - v1) < VICTORY.drawBand) return -1;
    return v0 > v1 ? 0 : 1;
  }

  /**
   * Share of the army's starting value still fighting: every unit in the fight
   * counts its cost times the share of its hit points left, so a badly hurt
   * colossus, monster or battery counts for what is left of it, and routing,
   * dead, fled and withdrawn units count for nothing.
   */
  remainingValue(side: Side): number {
    let start = 0;
    let now = 0;
    for (const u of this.units) {
      if (u.side !== side) continue;
      start += u.cost;
      if ((u.state === 'ready' || u.state === 'embarked') && !u.special.withdrawn) now += u.cost * unitHpShare(u);
    }
    return start > 0 ? now / start : 0;
  }

  finish(winner: Side | -1, reason: BattleResult['reason']): void {
    if (this.result) return;
    this.result = { winner, reason, time: this.time, sides: [this.summary(0), this.summary(1)] };
  }

  summary(side: Side): SideSummary {
    const units = this.units.filter((u) => u.side === side);
    let soldiersStart = 0;
    let soldiersLost = 0;
    let costStart = 0;
    let costLost = 0;
    for (const u of units) {
      soldiersStart += u.initial;
      const dead = u.soldiers.filter((s) => !s.alive && s.hp <= 0).length;
      soldiersLost += dead;
      costStart += u.cost;
      costLost += u.cost * (dead / u.initial);
    }
    return {
      faction: this.sides[side].faction,
      soldiersStart,
      soldiersLost,
      costStart,
      costLost,
      units: units.map((u) => ({
        id: u.id,
        def: u.def.id,
        name: u.def.name,
        start: u.initial,
        alive: u.alive,
        kills: u.kills,
        damageDealt: Math.round(u.damageDealt),
        valueDealt: Math.round(u.valueDealt),
        state: u.state,
        cost: u.cost,
        hp: hpShare(u),
      })),
    };
  }

  /** Units of a side, for convenience. */
  army(side: Side): Unit[] {
    return this.units.filter((u) => u.side === side);
  }

  factionOf(side: Side) {
    return factionDef(this.sides[side].faction);
  }
}

/** Rules that end a field battle before the time limit, and the timeout draw band. */
export const VICTORY = {
  /** An army with less than this share of its value still fighting may be broken... */
  brokenBelow: 0.25,
  /** ...when the enemy has at least this many times as much, plus the margin. */
  brokenRatio: 2,
  brokenMargin: 0.1,
  /** At the time limit, remaining values closer than this are a draw. */
  drawBand: 0.03,
};

export { unitHpShare };

function hpShare(u: Unit): number {
  return Math.round(unitHpShare(u) * 1000) / 1000;
}
