/**
 * Scripted battle AI. It plays either side, drives auto-resolve and runs the
 * balance simulator, so it must use every faction's core idea: the Choir's
 * slow lit advance, the Hush's bait and hook, the Vesperate's bell charges
 * and the Drift's downwind strike.
 *
 * It only acts on enemies it can see, and it issues ordinary commands.
 */
import type { AbilityDef, Area, Role } from '../data/schema';
import { angleDiff, datan2, dcos, dsin, HALF_PI } from '../core/dmath';
import type { Battle, Controller } from '../sim/battle';
import type { Command, Side, Unit } from '../sim/types';
import { castBlocker, casterPos } from '../sim/abilities';
import { effectiveRange, weaponOf } from '../sim/missiles';
import { formationSize } from '../sim/army';
import { hasMechanic, isFlyer } from '../sim/mechanics';
import { moraleState } from '../sim/morale';
import { tollActive } from '../sim/stats';

type Group = 'line' | 'missile' | 'cavalry' | 'skirmisher' | 'monster' | 'artillery' | 'flyer' | 'colossus' | 'lord' | 'hero' | 'support';

interface Memory {
  group: Group;
  lastCmd: string;
  lastTarget: number;
  lastX: number;
  lastY: number;
  lastTime: number;
  engagedSince: number;
  cycle: 'none' | 'out';
  cycleUntil: number;
}

/** The doc's counters table, for choosing melee targets. */
const BEATS: Partial<Record<Role, Role[]>> = {
  line: ['antiLarge', 'shockCav'],
  antiLarge: ['shockCav', 'monster', 'colossus', 'missileCav'],
  shock: ['line'],
  missile: ['monster'],
  shockCav: ['missile', 'artillery', 'support', 'missileCav', 'hero'],
  missileCav: ['monster'],
  monster: ['line', 'shock', 'missile', 'support'],
  artillery: ['monster', 'colossus'],
  flyer: ['artillery', 'missile'],
  colossus: ['line', 'shock', 'missile', 'shockCav'],
};
const LOSES: Partial<Record<Role, Role[]>> = {
  line: ['shock'],
  antiLarge: ['line'],
  shock: ['shockCav'],
  missile: ['shockCav', 'flyer', 'missileCav'],
  shockCav: ['antiLarge'],
  missileCav: ['shockCav'],
  monster: ['antiLarge'],
  artillery: ['shockCav', 'flyer'],
  flyer: [],
  colossus: ['antiLarge'],
};

export interface AIOptions {
  /** Force an opening stance; otherwise chosen from the armies and faction. */
  stance?: 'attack' | 'defend';
  /** Scales how eagerly the AI uses abilities (0 = never, 1 = normal). */
  abilityUse?: number;
  /** Seconds before a defending army gives up waiting and attacks. */
  patience?: number;
}

export class BattleAI implements Controller {
  private mem = new Map<number, Memory>();
  private stance: 'attack' | 'defend' = 'attack';
  private decided = false;
  private contact = -1;
  private readonly opts: AIOptions;

  constructor(opts: AIOptions = {}) {
    this.opts = opts;
  }

  update(b: Battle, side: Side): void {
    const mine = b.units.filter((u) => u.side === side && (u.state === 'ready' || u.state === 'embarked') && u.alive > 0);
    if (!mine.length) return;
    const foes = b.units.filter((u) => u.side !== side && u.state === 'ready' && u.alive > 0 && (u.visible[side] || b.time - u.lastSeen[side] < 2));
    const routers = b.units.filter((u) => u.side !== side && u.state === 'routing' && u.alive > 0 && u.visible[side]);
    if (!this.decided) this.decide(b, side, mine, foes);
    if (this.contact < 0 && mine.some((u) => u.engaged > 0)) this.contact = b.time;
    // Nobody wants to start it: after a while the defender advances anyway.
    const patience = this.opts.patience ?? 75;
    if (this.stance === 'defend' && this.contact < 0 && b.time > patience) this.stance = 'attack';
    if (this.stance === 'defend' && this.contact >= 0 && b.time - this.contact > 60 && b.remainingValue(side) > b.remainingValue((1 - side) as Side) + 0.1) {
      this.stance = 'attack';
    }
    const ctx = this.context(b, side, mine, foes);
    this.chooseHour(b, side, mine, foes);
    for (const u of mine) {
      const m = this.memory(u);
      if (u.state === 'embarked') continue;
      if (u.engaged > 0) {
        if (m.engagedSince < 0) m.engagedSince = b.time;
      } else m.engagedSince = -1;
      switch (m.group) {
        case 'line':
          this.line(b, side, u, m, ctx, foes);
          break;
        case 'support':
          this.support(b, side, u, ctx, foes);
          break;
        case 'missile':
          this.missile(b, side, u, m, ctx, foes);
          break;
        case 'artillery':
          this.artillery(b, side, u, m, ctx, foes);
          break;
        case 'cavalry':
          this.cavalry(b, side, u, m, ctx, foes, routers);
          break;
        case 'skirmisher':
          this.skirmisher(b, side, u, m, ctx, foes);
          break;
        case 'monster':
          this.monster(b, side, u, m, ctx, foes);
          break;
        case 'flyer':
          this.flyer(b, side, u, m, ctx, foes);
          break;
        case 'colossus':
          this.colossus(b, side, u, m, ctx, foes);
          break;
        case 'lord':
        case 'hero':
          this.character(b, side, u, m, ctx, foes);
          break;
      }
      if ((this.opts.abilityUse ?? 1) > 0) this.abilities(b, side, u, foes);
    }
  }

  // ------------------------------------------------------------------ setup

  private memory(u: Unit): Memory {
    let m = this.mem.get(u.id);
    if (!m) {
      m = { group: groupOf(u), lastCmd: '', lastTarget: -1, lastX: 0, lastY: 0, lastTime: -99, engagedSince: -1, cycle: 'none', cycleUntil: 0 };
      this.mem.set(u.id, m);
    }
    return m;
  }

  private decide(b: Battle, side: Side, mine: Unit[], foes: Unit[]): void {
    this.decided = true;
    if (this.opts.stance) {
      this.stance = this.opts.stance;
      return;
    }
    const ranged = (list: Unit[]) => list.reduce((a, u) => a + (u.def.missile ? u.cost : 0), 0);
    const total = (list: Unit[]) => list.reduce((a, u) => a + u.cost, 0);
    const myR = ranged(mine) / Math.max(1, total(mine));
    const foeR = ranged(foes) / Math.max(1, total(foes));
    const f = b.sides[side].faction;
    // Let the side with the better missiles hold; the Hush wait in the dark; the Drift strike.
    if (f === 'drift') this.stance = 'attack';
    else if (f === 'hush') this.stance = b.terrain.light <= 1 || foeR > myR ? 'defend' : 'attack';
    else if (myR > foeR + 0.08) this.stance = 'defend';
    else this.stance = 'attack';
    if (b.terrain.fort) this.stance = b.terrain.fort.defender === side ? 'defend' : 'attack';
    // Everyone starts in a running state for the approach.
    for (const u of mine) {
      if (groupOf(u) === 'line' || groupOf(u) === 'missile') b.issue(side, { type: 'run', unit: u.id, on: false }, false);
    }
  }

  private context(b: Battle, side: Side, mine: Unit[], foes: Unit[]) {
    const c = (list: Unit[]) => {
      let x = 0;
      let y = 0;
      let n = 0;
      for (const u of list) {
        x += u.x * u.alive;
        y += u.y * u.alive;
        n += u.alive;
      }
      return n ? { x: x / n, y: y / n } : { x: b.terrain.width / 2, y: side === 0 ? 0 : b.terrain.height };
    };
    const lineUnits = mine.filter((u) => this.memory(u).group === 'line');
    const me = c(lineUnits.length ? lineUnits : mine);
    const them = c(foes.length ? foes : b.units.filter((u) => u.side !== side && u.alive > 0));
    const dir = datan2(them.y - me.y, them.x - me.x);
    // The front: how far forward our line stands, along the axis toward the enemy.
    const fwd = (u: Unit) => (u.x - me.x) * dcos(dir) + (u.y - me.y) * dsin(dir);
    const fronts = lineUnits.map(fwd).sort((a, z) => a - z);
    const median = fronts.length ? fronts[Math.floor(fronts.length / 2)]! : 0;
    const gap = Math.sqrt((them.x - me.x) * (them.x - me.x) + (them.y - me.y) * (them.y - me.y));
    return { me, them, dir, fwd, median, gap };
  }

  // ------------------------------------------------------------- utilities

  private order(b: Battle, side: Side, u: Unit, cmd: Command): void {
    const m = this.memory(u);
    const now = b.time;
    if (cmd.type === 'attack') {
      if (m.lastCmd === 'attack' && m.lastTarget === cmd.target && u.order.kind === 'attack') return;
      m.lastTarget = cmd.target;
    } else if (cmd.type === 'move') {
      const d2 = (m.lastX - cmd.x) * (m.lastX - cmd.x) + (m.lastY - cmd.y) * (m.lastY - cmd.y);
      if (m.lastCmd === 'move' && d2 < 36 && now - m.lastTime < 4 && u.order.kind === 'move') return;
      m.lastX = cmd.x;
      m.lastY = cmd.y;
    } else if (cmd.type === 'halt') {
      if (u.order.kind === 'hold' && !u.meleeTarget) return;
    }
    m.lastCmd = cmd.type;
    m.lastTime = now;
    b.issue(side, cmd, false);
  }

  private dist(a: { x: number; y: number }, c: { x: number; y: number }): number {
    return Math.sqrt((a.x - c.x) * (a.x - c.x) + (a.y - c.y) * (a.y - c.y));
  }

  /** Gap between two units' edges, roughly. */
  private edgeGap(a: Unit, c: Unit): number {
    const sa = formationSize(a);
    const sc = formationSize(c);
    return this.dist(a, c) - (sa.depth + sc.depth) * 0.5 - (a.def.radius ?? 0) - (c.def.radius ?? 0);
  }

  private meleeScore(b: Battle, u: Unit, e: Unit): number {
    if (e.soldiers.every((s) => !s.alive || s.airborne) && !isFlyer(u.def)) return -Infinity;
    const d = this.edgeGap(u, e);
    let s = -d / 8;
    const r = u.def.role;
    if (BEATS[r]?.includes(e.def.role)) s += 30;
    if (LOSES[r]?.includes(e.def.role)) s -= 35;
    if (e.state === 'routing') s -= 25;
    if (e.engaged > 0) {
      // Flanking an enemy already pinned by our troops.
      const ang = Math.abs(angleDiff(e.facing, datan2(u.y - e.y, u.x - e.x)));
      if (ang > 1.2) s += 25;
      else s += 6;
    }
    if (u.def.size === 'large' && u.def.category !== 'colossus') {
      const braced = e.def.role === 'antiLarge' && !e.moving && e.engaged === 0;
      if (braced) s -= 45;
    }
    if (e.alive / e.initial < 0.35) s += 8;
    if (e.def.category === 'colossus' && u.def.role !== 'antiLarge' && u.def.role !== 'colossus') s -= 15;
    if (hasMechanic(e.def, 'moltenCore') && u.def.category === 'cavalry') s -= 10;
    void b;
    return s;
  }

  private bestMeleeTarget(b: Battle, u: Unit, foes: Unit[], maxGap = Infinity): Unit | null {
    let best: Unit | null = null;
    let bs = -Infinity;
    for (const e of foes) {
      if (this.edgeGap(u, e) > maxGap) continue;
      const s = this.meleeScore(b, u, e);
      if (s > bs) {
        bs = s;
        best = e;
      }
    }
    return best;
  }

  private threatNear(u: Unit, foes: Unit[], radius: number, filter?: (e: Unit) => boolean): Unit | null {
    let best: Unit | null = null;
    let bd = radius;
    for (const e of foes) {
      if (filter && !filter(e)) continue;
      const d = this.edgeGap(u, e);
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    return best;
  }

  private moveTo(b: Battle, side: Side, u: Unit, x: number, y: number, facing: number, run: boolean): void {
    x = Math.max(10, Math.min(b.terrain.width - 10, x));
    y = Math.max(10, Math.min(b.terrain.height - 10, y));
    this.order(b, side, u, { type: 'move', unit: u.id, x, y, facing, run });
  }

  // ----------------------------------------------------------------- groups

  private line(b: Battle, side: Side, u: Unit, m: Memory, ctx: Ctx, foes: Unit[]): void {
    if (u.engaged > 0) {
      // Keep fighting; retarget only if our target is gone.
      if (!u.meleeTarget || u.meleeTarget.state !== 'ready') {
        const t = this.bestMeleeTarget(b, u, foes, 30);
        if (t) this.order(b, side, u, { type: 'attack', unit: u.id, target: t.id, run: true });
      }
      return;
    }
    // Braced stances wait for the charge.
    if (u.abilities.some((a) => a.on && a.def.stance?.immobile)) {
      const threat = this.threatNear(u, foes, 160, (e) => e.def.size !== 'small');
      if (threat) return;
    }
    const engageGap = this.stance === 'attack' ? 70 : 38;
    const t = this.bestMeleeTarget(b, u, foes, engageGap);
    if (t && (this.stance === 'attack' || this.edgeGap(u, t) < 38)) {
      this.order(b, side, u, { type: 'attack', unit: u.id, target: t.id, run: true });
      return;
    }
    if (this.stance === 'defend') {
      if (u.order.kind === 'attack') this.order(b, side, u, { type: 'halt', unit: u.id });
      return;
    }
    // Advance in step with the line.
    const f = ctx.fwd(u);
    const ahead = f - ctx.median;
    if (ahead > 14) {
      if (u.order.kind !== 'hold') this.order(b, side, u, { type: 'halt', unit: u.id });
      return;
    }
    const step = 40;
    const x = u.x + dcos(ctx.dir) * step;
    const y = u.y + dsin(ctx.dir) * step;
    void m;
    this.moveTo(b, side, u, x, y, ctx.dir, false);
  }

  private missile(b: Battle, side: Side, u: Unit, m: Memory, ctx: Ctx, foes: Unit[]): void {
    const w = weaponOf(u);
    const hasAmmo = u.soldiers.some((s) => s.alive && s.ammo > 0);
    if (!w || !hasAmmo) {
      // Out of ammunition: join the melee where it helps.
      const t = this.bestMeleeTarget(b, u, foes.filter((e) => e.engaged > 0), 120);
      if (t) this.order(b, side, u, { type: 'attack', unit: u.id, target: t.id, run: true });
      return;
    }
    if (u.engaged > 0) {
      // Pull back from melee if our line can cover.
      if (u.engaged > u.alive * 0.3 && hasMechanic(u.def, 'feignedFlight')) {
        this.moveTo(b, side, u, u.x - dcos(ctx.dir) * 50, u.y - dsin(ctx.dir) * 50, ctx.dir, true);
      }
      return;
    }
    // Melee threat closing in: fall back behind the line.
    const threat = this.threatNear(u, foes, 45, (e) => !e.def.missile || e.def.category === 'cavalry');
    if (threat && threat.meleeTarget === u) {
      this.moveTo(b, side, u, u.x - dcos(ctx.dir) * 45, u.y - dsin(ctx.dir) * 45, ctx.dir, true);
      return;
    }
    // Pick a target: fire at will does this, but prefer shooting what our line isn't fighting.
    let best: Unit | null = null;
    let bs = -Infinity;
    for (const e of foes) {
      const dir = datan2(e.y - u.y, e.x - u.x);
      const range = effectiveRange(b, u, w, dir);
      const d = this.dist(u, e);
      if (d > range * 1.02) continue;
      let s = 100 - d / 4;
      if (e.engaged > 0) s -= w.trajectory === 'beam' ? 25 : 70;
      if (e.def.role === 'missile') s += 15;
      if (e.def.category === 'monster' || e.def.category === 'colossus') s += 12;
      if (w.preferLarge) s += e.def.size !== 'small' ? 50 : -30;
      if (w.ap > w.damage && e.def.armor > 50) s += 15;
      if (w.armorMult && e.def.armor > 50) s -= 25;
      if (w.trajectory === 'beam' && b.zones.some((z) => z.def.blocksBeams && z.side !== side && this.dist(z, e) < z.radius)) s -= 60;
      if (s > bs) {
        bs = s;
        best = e;
      }
    }
    if (best && bs > 0) {
      if (u.missileTarget !== best) this.order(b, side, u, { type: 'attack', unit: u.id, target: best.id, run: false });
      return;
    }
    // Nothing in range: keep position behind our line.
    const lineAnchor = ctx.me;
    const back = this.stance === 'defend' ? 32 : 26;
    const wantF = ctx.median - back;
    const f = ctx.fwd(u);
    if (Math.abs(f - wantF) > 12 || this.stance === 'attack') {
      const lateral = (u.x - lineAnchor.x) * -dsin(ctx.dir) + (u.y - lineAnchor.y) * dcos(ctx.dir);
      const tf = this.stance === 'attack' ? Math.max(f, wantF) + (f < wantF + 20 ? 30 : 0) : wantF;
      const x = lineAnchor.x + dcos(ctx.dir) * tf - dsin(ctx.dir) * lateral;
      const y = lineAnchor.y + dsin(ctx.dir) * tf + dcos(ctx.dir) * lateral;
      this.moveTo(b, side, u, x, y, ctx.dir, false);
    }
    void m;
  }

  /** Bell wagons and kites keep behind the line; kites edge toward being upwind of the enemy. */
  private support(b: Battle, side: Side, u: Unit, ctx: Ctx, foes: Unit[]): void {
    if (u.engaged > 0) return;
    const threat = this.threatNear(u, foes, 40);
    if (threat) {
      const away = datan2(u.y - threat.y, u.x - threat.x);
      this.moveTo(b, side, u, u.x + dcos(away) * 50, u.y + dsin(away) * 50, ctx.dir, true);
      return;
    }
    const howl = hasMechanic(u.def, 'howl');
    const back = howl ? 12 : 30;
    const tf = ctx.median - back;
    const lateral = (u.x - ctx.me.x) * -dsin(ctx.dir) + (u.y - ctx.me.y) * dcos(ctx.dir);
    const lat = Math.max(-150, Math.min(150, lateral));
    const x = ctx.me.x + dcos(ctx.dir) * tf - dsin(ctx.dir) * lat;
    const y = ctx.me.y + dsin(ctx.dir) * tf + dcos(ctx.dir) * lat;
    if (this.dist(u, { x, y }) > 15) this.moveTo(b, side, u, x, y, ctx.dir, false);
  }

  private artillery(b: Battle, side: Side, u: Unit, _m: Memory, ctx: Ctx, foes: Unit[]): void {
    const w = weaponOf(u);
    if (!w) return;
    // Hold back and shoot; creep forward if nothing is in range.
    let inRange = false;
    for (const e of foes) {
      const dir = datan2(e.y - u.y, e.x - u.x);
      if (this.dist(u, e) < effectiveRange(b, u, w, dir) * 0.95) {
        inRange = true;
        break;
      }
    }
    if (!inRange && foes.length) {
      const x = u.x + dcos(ctx.dir) * 40;
      const y = u.y + dsin(ctx.dir) * 40;
      if (ctx.fwd(u) < ctx.median - 50) this.moveTo(b, side, u, x, y, ctx.dir, false);
    } else if (u.order.kind === 'move' && inRange && !w.whileMoving) {
      this.order(b, side, u, { type: 'halt', unit: u.id });
    }
  }

  private cavalry(b: Battle, side: Side, u: Unit, m: Memory, ctx: Ctx, foes: Unit[], routers: Unit[]): void {
    // Cycle charges: hit, pull out, hit again.
    if (m.cycle === 'out') {
      if (b.time < m.cycleUntil) return;
      m.cycle = 'none';
    }
    if (u.engaged > 0) {
      const t = u.meleeTarget;
      const long = m.engagedSince >= 0 && b.time - m.engagedSince > 9;
      const losing = u.meleeTaken > u.meleeDealt * 1.3;
      const vsBraced = t && (t.def.role === 'antiLarge' || t.def.role === 'line') && t.state === 'ready';
      if ((long && vsBraced) || (losing && u.morale > u.maxMorale * 0.35)) {
        m.cycle = 'out';
        m.cycleUntil = b.time + 7;
        const away = t ? datan2(u.y - t.y, u.x - t.x) : ctx.dir + Math.PI;
        this.moveTo(b, side, u, u.x + dcos(away) * 70, u.y + dsin(away) * 70, away + Math.PI, true);
      }
      return;
    }
    // Mop up routers late in the fight.
    if (this.contact >= 0 && routers.length && b.time - this.contact > 40) {
      const r = routers.reduce((a, c) => (this.dist(u, c) < this.dist(u, a) ? c : a));
      if (this.dist(u, r) < 250) {
        this.order(b, side, u, { type: 'attack', unit: u.id, target: r.id, run: true });
        return;
      }
    }
    const engagedFoes = foes.filter((e) => e.engaged > 0);
    // Before the lines meet, guard a wing.
    if (this.contact < 0 || !engagedFoes.length) {
      // Hunt exposed missiles and artillery that are close.
      const prey = this.threatNear(u, foes, 180, (e) => (e.def.role === 'missile' || e.def.role === 'artillery') && e.engaged === 0 && !this.guarded(e, foes));
      if (prey && this.stance === 'attack') {
        this.charge(b, side, u, prey);
        return;
      }
      // Counter enemy cavalry heading for our missiles.
      const raider = this.threatNear(u, foes, 160, (e) => e.def.category === 'cavalry' && e.engaged === 0);
      if (raider && u.def.role === 'shockCav' && raider.def.role !== 'antiLarge') {
        this.charge(b, side, u, raider);
        return;
      }
      const wing = this.wingPosition(b, u, ctx);
      this.moveTo(b, side, u, wing.x, wing.y, ctx.dir, false);
      return;
    }
    // Lines are engaged: charge the rear or flank of a pinned enemy, or run down missiles.
    let best: Unit | null = null;
    let bs = -Infinity;
    for (const e of foes) {
      let s = this.meleeScore(b, u, e);
      if (e.engaged > 0) {
        const ang = Math.abs(angleDiff(e.facing, datan2(u.y - e.y, u.x - e.x)));
        s += ang > 1.6 ? 30 : ang > 1.1 ? 15 : -10;
      } else if (e.def.role === 'missile' || e.def.role === 'artillery') s += 20;
      s -= this.dist(u, e) / 12;
      if (s > bs) {
        bs = s;
        best = e;
      }
    }
    if (best) this.charge(b, side, u, best);
  }

  private guarded(e: Unit, foes: Unit[]): boolean {
    return foes.some((o) => o !== e && o.def.role === 'antiLarge' && this.dist(o, e) < 60);
  }

  /** Charge, coming around to hit a pinned target from the side, timing Vesperate charges on the bell. */
  private charge(b: Battle, side: Side, u: Unit, t: Unit): void {
    const d = this.dist(u, t);
    // Vesperate: wait for the bell if it is close.
    if (u.faction === 'vesperate' && hasMechanic(u.def, 'tollCharge') && !tollActive(b, u) && d < 140 && d > 60) {
      const st = b.sides[side];
      const until = st.tollInterval - st.tollTimer;
      const arrive = d / Math.max(1, u.def.speed);
      if (until > arrive + 1 && until < 12) {
        // Hover out of charge range until the Toll.
        const away = datan2(u.y - t.y, u.x - t.x);
        this.moveTo(b, side, u, t.x + dcos(away) * 95, t.y + dsin(away) * 95, away + Math.PI, false);
        return;
      }
    }
    if (t.engaged > 0 && d > 90) {
      // Swing to the target's flank before committing.
      const flank = t.facing + (angleDiff(t.facing, datan2(u.y - t.y, u.x - t.x)) > 0 ? HALF_PI * 1.5 : -HALF_PI * 1.5);
      const px = t.x + dcos(flank) * 70;
      const py = t.y + dsin(flank) * 70;
      if (this.dist(u, { x: px, y: py }) > 40) {
        this.moveTo(b, side, u, px, py, datan2(t.y - py, t.x - px), true);
        return;
      }
    }
    this.order(b, side, u, { type: 'attack', unit: u.id, target: t.id, run: true });
  }

  private wingPosition(b: Battle, u: Unit, ctx: Ctx): { x: number; y: number } {
    const lateral = (u.x - ctx.me.x) * -dsin(ctx.dir) + (u.y - ctx.me.y) * dcos(ctx.dir);
    const sign = lateral >= 0 ? 1 : -1;
    const lat = sign * Math.max(Math.abs(lateral), 200);
    const f = ctx.median - 10 + (this.stance === 'attack' ? 20 : 0);
    const x = ctx.me.x + dcos(ctx.dir) * f - dsin(ctx.dir) * lat;
    const y = ctx.me.y + dsin(ctx.dir) * f + dcos(ctx.dir) * lat;
    void b;
    return { x, y };
  }

  private skirmisher(b: Battle, side: Side, u: Unit, m: Memory, ctx: Ctx, foes: Unit[]): void {
    const w = weaponOf(u);
    const hasAmmo = u.soldiers.some((s) => s.alive && s.ammo > 0);
    if (!w || !hasAmmo) return this.cavalry(b, side, u, m, ctx, foes, []);
    if (u.engaged > 0) {
      // Break away: missile cavalry never stays pinned.
      const t = u.meleeTarget;
      const away = t ? datan2(u.y - t.y, u.x - t.x) : ctx.dir + Math.PI;
      this.moveTo(b, side, u, u.x + dcos(away) * 80, u.y + dsin(away) * 80, away, true);
      return;
    }
    // Run from melee threats.
    const danger = this.threatNear(u, foes, 55, (e) => (e.def.category === 'cavalry' || e.def.category === 'beast' || e.def.category === 'flyer') && !e.def.missile);
    if (danger) {
      const away = datan2(u.y - danger.y, u.x - danger.x);
      this.moveTo(b, side, u, u.x + dcos(away) * 90, u.y + dsin(away) * 90, away, true);
      return;
    }
    // Harass: target something slow, stay near 70% of range, preferably downwind of us.
    let best: Unit | null = null;
    let bs = -Infinity;
    for (const e of foes) {
      let s = -this.dist(u, e) / 10;
      if (e.def.category === 'infantry' && !e.def.missile) s += 20;
      if (e.def.category === 'monster') s += 15;
      if (e.def.role === 'missile') s -= 20;
      if (e.def.category === 'cavalry' && !e.def.missile) s -= 30;
      if (s > bs) {
        bs = s;
        best = e;
      }
    }
    if (!best) return;
    const dirTo = datan2(best.y - u.y, best.x - u.x);
    const range = effectiveRange(b, u, w, dirTo);
    const d = this.dist(u, best);
    if (d > range * 0.95 || d < range * 0.5) {
      // Stand off at 70% of range, on the nightward side if we can (wind at our back).
      const standDir = datan2(u.y - best.y, u.x - best.x);
      const upwind = b.terrain.sunBearing + Math.PI;
      const blend = standDir + angleDiff(standDir, upwind) * (u.faction === 'drift' ? 0.35 : 0.1);
      const x = best.x + dcos(blend) * range * 0.72;
      const y = best.y + dsin(blend) * range * 0.72;
      this.moveTo(b, side, u, x, y, datan2(best.y - y, best.x - x), true);
    }
    if (u.missileTarget !== best) {
      u.fireAtWill = true;
      b.issue(side, { type: 'fireAtWill', unit: u.id, on: true }, false);
    }
  }

  private monster(b: Battle, side: Side, u: Unit, _m: Memory, ctx: Ctx, foes: Unit[]): void {
    if (u.engaged > 0 && u.meleeTarget && u.meleeTarget.state === 'ready') return;
    if (this.stance === 'defend' && this.contact < 0) {
      const t = this.bestMeleeTarget(b, u, foes, 60);
      if (t) this.order(b, side, u, { type: 'attack', unit: u.id, target: t.id, run: true });
      return;
    }
    const t = this.bestMeleeTarget(b, u, foes);
    if (t && (this.edgeGap(u, t) < 160 || this.contact >= 0)) {
      this.order(b, side, u, { type: 'attack', unit: u.id, target: t.id, run: true });
    } else {
      this.moveTo(b, side, u, u.x + dcos(ctx.dir) * 40, u.y + dsin(ctx.dir) * 40, ctx.dir, false);
    }
  }

  private flyer(b: Battle, side: Side, u: Unit, m: Memory, ctx: Ctx, foes: Unit[]): void {
    const hasAmmo = u.def.missile && u.soldiers.some((s) => s.alive && s.ammo > 0);
    // Gliders low on glide time go refit on the Dreadsail if there is one.
    if (u.special.glide !== undefined && (u.special.glide < 20 || !hasAmmo)) {
      const carrier = b.units.find((c) => c.side === side && c.state === 'ready' && hasMechanic(c.def, 'carrier'));
      if (carrier) {
        this.moveTo(b, side, u, carrier.x, carrier.y, carrier.facing, true);
        return;
      }
    }
    if (u.engaged > 0) {
      const losing = u.meleeTaken > u.meleeDealt * 1.5;
      if (losing) {
        const away = ctx.dir + Math.PI;
        this.moveTo(b, side, u, u.x + dcos(away) * 120, u.y + dsin(away) * 120, ctx.dir, true);
      }
      return;
    }
    // Prey: artillery and missiles that aren't guarded by lots of arrows.
    let best: Unit | null = null;
    let bs = -Infinity;
    for (const e of foes) {
      let s = -this.dist(u, e) / 15;
      if (e.def.role === 'artillery') s += 45;
      if (e.def.role === 'missile' && !e.def.missile?.preferLarge) s += 25;
      if (e.def.role === 'antiLarge') s -= 25;
      if (e.def.category === 'cavalry' || e.def.category === 'flyer') s -= 15;
      const shooters = foes.filter((o) => o.def.missile && o.def.role === 'missile' && this.dist(o, e) < 120).length;
      s -= shooters * 12;
      if (s > bs) {
        bs = s;
        best = e;
      }
    }
    if (!best) return;
    if (hasAmmo) {
      // Bombing runs: fly over the target and out the other side.
      const d = this.dist(u, best);
      if (d > 30) {
        const dir = datan2(best.y - u.y, best.x - u.x);
        this.moveTo(b, side, u, best.x + dcos(dir) * 60, best.y + dsin(dir) * 60, dir, true);
        if (u.missileTarget !== best) b.issue(side, { type: 'attack', unit: u.id, target: best.id, run: true }, false);
        m.lastCmd = 'move';
      }
      return;
    }
    if (this.contact >= 0 || this.stance === 'attack') this.order(b, side, u, { type: 'attack', unit: u.id, target: best.id, run: true });
  }

  private colossus(b: Battle, side: Side, u: Unit, _m: Memory, ctx: Ctx, foes: Unit[]): void {
    if (hasMechanic(u.def, 'sailing')) return this.dreadsail(b, side, u, ctx, foes);
    // Old Midnight takes aboard up to two missile units at the start.
    if (hasMechanic(u.def, 'garrison') && b.time < 3) {
      const riders = b.units.filter((o) => o.side === side && o.state === 'ready' && b.canEmbark(o, u)).slice(0, 2);
      for (const r of riders) b.issue(side, { type: 'embark', unit: r.id, target: u.id }, false);
    }
    if (u.engaged > 0 && u.meleeTarget && u.meleeTarget.state === 'ready') return;
    const flying = isFlyer(u.def);
    let best: Unit | null = null;
    let bs = -Infinity;
    for (const e of foes) {
      let s = -this.dist(u, e) / 12 + e.alive / 8;
      if (flying) {
        if (e.def.role === 'artillery' || e.def.role === 'missile') s += 25;
        if (e.def.missile?.preferLarge) s -= 30;
      }
      if (e.def.role === 'antiLarge') s -= 15;
      if (e.def.category === 'colossus') s += 5;
      if (s > bs) {
        bs = s;
        best = e;
      }
    }
    if (!best) return;
    const wait = this.stance === 'defend' && this.contact < 0 && this.edgeGap(u, best) > 50;
    if (wait) return;
    // Walk with the line; don't run ahead alone.
    const f = ctx.fwd(u);
    if (!flying && this.contact < 0 && f - ctx.median > 25 && this.edgeGap(u, best) > 60) {
      if (u.order.kind !== 'hold') this.order(b, side, u, { type: 'halt', unit: u.id });
      return;
    }
    this.order(b, side, u, { type: 'attack', unit: u.id, target: best.id, run: true });
  }

  /** Sail across the enemy line with the wind, ram what's ahead, broadside the rest. */
  private dreadsail(b: Battle, side: Side, u: Unit, ctx: Ctx, foes: Unit[]): void {
    if (!foes.length) return;
    const down = b.terrain.sunBearing;
    const hull = casterPos(u);
    // Anything in front and downwind to ram?
    const aheadTarget = foes.find((e) => {
      const d = this.dist(hull, e);
      if (d > 110 || d < 15) return false;
      return Math.abs(angleDiff(u.facing, datan2(e.y - hull.y, e.x - hull.x))) < 0.35;
    });
    const ram = u.abilities.find((a) => a.def.id === 'rammingRun');
    if (aheadTarget && ram && castBlocker(b, u, ram) === null && Math.abs(angleDiff(u.facing, down)) < 1.0 && u.moving) {
      b.issue(side, { type: 'ability', unit: u.id, ability: 'rammingRun' }, false);
    }
    // Waypoints: pass alongside the enemy mass, preferring downwind legs.
    const m = this.memory(u);
    const target = ctx.them;
    const toT = datan2(target.y - hull.y, target.x - hull.x);
    let heading = toT + angleDiff(toT, down) * 0.5;
    const d = this.dist(hull, target);
    if (d < 120) heading = u.facing; // run through
    const leg = Math.min(260, Math.max(120, d));
    let x = hull.x + dcos(heading) * leg;
    let y = hull.y + dsin(heading) * leg;
    // Turn around near the map edge.
    const W = b.terrain.width;
    const H = b.terrain.height;
    if (x < 60 || x > W - 60 || y < 60 || y > H - 60) {
      x = W / 2 + (target.x - W / 2) * 0.3;
      y = H / 2 + (target.y - H / 2) * 0.3;
    }
    if (b.time - m.lastTime > 3 || u.order.kind === 'hold') this.moveTo(b, side, u, x, y, datan2(y - hull.y, x - hull.x), true);
  }

  private character(b: Battle, side: Side, u: Unit, m: Memory, ctx: Ctx, foes: Unit[]): void {
    const duelist = u.def.role === 'lord' ? (u.def.leader?.ma ?? 0) >= 50 : u.def.weapon.base >= 45;
    if (u.engaged > 0) return;
    // Casters and the general stay behind the line; duelists join once the lines meet.
    if (duelist && this.contact >= 0) {
      const enemyChar = foes.find((e) => e.def.character && e.engaged > 0 && this.dist(u, e) < 200);
      const t = enemyChar ?? this.bestMeleeTarget(b, u, foes.filter((e) => e.engaged > 0), 150);
      if (t && u.alive > 0 && u.soldiers[0]!.hp / u.soldiers[0]!.maxHp > 0.35) {
        this.order(b, side, u, { type: 'attack', unit: u.id, target: t.id, run: true });
        return;
      }
    }
    // Threatened: defend yourself.
    const threat = this.threatNear(u, foes, 30);
    if (threat) {
      this.order(b, side, u, { type: 'attack', unit: u.id, target: threat.id, run: true });
      return;
    }
    const back = u.def.role === 'lord' ? 55 : 40;
    const tf = ctx.median - back;
    const f = ctx.fwd(u);
    if (Math.abs(f - tf) > 20) {
      const lateral = (u.x - ctx.me.x) * -dsin(ctx.dir) + (u.y - ctx.me.y) * dcos(ctx.dir);
      const lat = Math.max(-120, Math.min(120, lateral));
      const x = ctx.me.x + dcos(ctx.dir) * tf - dsin(ctx.dir) * lat;
      const y = ctx.me.y + dsin(ctx.dir) * tf + dcos(ctx.dir) * lat;
      this.moveTo(b, side, u, x, y, ctx.dir, isFlyer(u.def));
    }
    void m;
  }

  // -------------------------------------------------------------- abilities

  private abilities(b: Battle, side: Side, u: Unit, foes: Unit[]): void {
    if (u.state !== 'ready') return;
    for (const a of u.abilities) {
      const def = a.def;
      const hint = def.ai ?? 'never';
      if (hint === 'never') continue;
      if (def.kind === 'toggle') {
        this.toggle(b, side, u, a.def, a.on, foes);
        continue;
      }
      if (castBlocker(b, u, a, u.x, u.y, u.id) === 'Recharging' || a.uses <= 0 || a.cooldown > 0 || a.windup > 0 || a.channel > 0) continue;
      const cast = this.planCast(b, side, u, def, hint, foes);
      if (!cast) continue;
      if (castBlocker(b, u, a, cast.x, cast.y, cast.target) !== null) continue;
      b.issue(side, { type: 'ability', unit: u.id, ability: def.id, x: cast.x, y: cast.y, target: cast.target }, false);
      return;
    }
  }

  private toggle(b: Battle, side: Side, u: Unit, def: AbilityDef, on: boolean, foes: Unit[]): void {
    const hint = def.ai;
    if (hint === 'selfWhenCavalryNear') {
      const threat = this.threatNear(u, foes, 90, (e) => e.def.size === 'large' && e.def.category !== 'colossus' && !isFlyer(e.def) && (e.order.kind === 'attack' || e.moving));
      if (!on && threat && u.engaged === 0) b.issue(side, { type: 'ability', unit: u.id, ability: def.id }, false);
      else if (on && !this.threatNear(u, foes, 200, (e) => e.def.size === 'large' && !isFlyer(e.def)) && u.engaged === 0) b.issue(side, { type: 'ability', unit: u.id, ability: def.id }, false);
    } else if (hint === 'whenLosing') {
      // Drop Anchor when pinned and burning; raise it when free.
      const pinned = u.engaged > 0 || (u.special.sailsBurning ?? 0) > 0;
      if (!on && pinned && u.damageTaken > u.hpStart * 0.3) b.issue(side, { type: 'ability', unit: u.id, ability: def.id }, false);
      else if (on && !pinned && u.engaged === 0) b.issue(side, { type: 'ability', unit: u.id, ability: def.id }, false);
    }
  }

  private planCast(b: Battle, side: Side, u: Unit, def: AbilityDef, hint: string, foes: Unit[]): { x?: number; y?: number; target?: number } | null {
    const o = casterPos(u);
    const range = def.range ?? 0;
    const area = firstArea(def);
    switch (hint) {
      case 'selfWhenEngaged':
        return u.engaged > Math.max(1, u.alive * 0.2) ? {} : null;
      case 'always': {
        if (def.target === 'point') {
          // Gust over our own missile units that are shooting downwind; else over our line.
          const shooters = b.units.filter((f) => f.side === side && f.state === 'ready' && f.def.missile && f.missileTarget && this.dist(o, f) < range);
          const pick = shooters[0];
          if (!pick) return null;
          return { x: pick.x, y: pick.y };
        }
        if (def.effects.some((e) => e.kind === 'buff' && e.tag === 'retune')) {
          const art = b.units.filter((f) => f.side === side && f.state === 'ready' && f.def.role === 'artillery' && this.dist(o, f) < 150 && f.missileTarget);
          return art.length ? {} : null;
        }
        if (def.effects.some((e) => e.kind === 'script' && e.name === 'allSails')) {
          const movingDown = b.units.filter((f) => f.side === side && f.moving && Math.abs(angleDiff(f.facing, b.terrain.sunBearing)) < 1).length;
          return movingDown >= 3 ? {} : null;
        }
        return {};
      }
      case 'onEnemyCluster':
      case 'onEnemyInFront': {
        const pts = this.clusterCandidates(b, side, u, foes, def, area, hint === 'onEnemyInFront');
        return pts;
      }
      case 'onAllyCluster': {
        const rep = def.effects.find((e) => e.kind === 'repair');
        if (!rep || rep.kind !== 'repair') return null;
        const t = b.units.find((f) => f.side === side && f.state === 'ready' && rep.targets.includes(f.def.id) && this.dist(o, f) <= range && f.soldiers.some((s) => s.alive && s.hp < s.maxHp * 0.75));
        return t ? { target: t.id } : null;
      }
      case 'onHiddenEnemies': {
        // Light up where an enemy vanished, or where our troops are being hit by something unseen.
        for (const e of b.units) {
          if (e.side === side || e.alive <= 0 || e.state !== 'ready') continue;
          if (e.visible[side]) continue;
          if (b.time - e.lastSeen[side] > 25) continue;
          if (this.dist(o, e) > range) continue;
          return { x: e.x, y: e.y };
        }
        const hurt = b.units.find((f) => f.side === side && f.state === 'ready' && f.engaged > 0 && foes.every((e) => this.dist(e, f) > 40) && this.dist(o, f) < range);
        if (hurt) return { x: hurt.x, y: hurt.y };
        // Otherwise use it to brighten the target of our beams.
        const beams = b.units.find((f) => f.side === side && f.state === 'ready' && f.def.missile?.lightScaled && f.missileTarget && this.dist(o, f.missileTarget) < range);
        if (beams && beams.missileTarget && beams.light < 3) return { x: (beams.x + beams.missileTarget.x) / 2, y: (beams.y + beams.missileTarget.y) / 2 };
        return null;
      }
      case 'onEnemyCharacter': {
        const t = foes.find((e) => e.def.character && this.dist(o, e) <= range);
        return t ? { target: t.id } : null;
      }
      case 'onEnemyArtillery': {
        const t = foes.find((e) => (e.def.role === 'artillery' || e.def.character) && this.dist(o, e) <= range);
        return t ? { target: t.id } : null;
      }
      case 'whenEnemyBeams': {
        const beamers = foes.filter((e) => e.def.missile && (e.def.missile.trajectory === 'beam' || e.def.missile.trajectory === 'lineBeam') && e.missileTarget);
        for (const e of beamers) {
          const t = e.missileTarget!;
          if (t.side !== side) continue;
          const mx = t.x + (e.x - t.x) * 0.15;
          const my = t.y + (e.y - t.y) * 0.15;
          if (this.dist(o, { x: mx, y: my }) <= range) return { x: mx, y: my };
        }
        const noon = foes.find((e) => e.def.id === 'choir.nailbearer');
        if (noon && this.dist(o, noon) < range) return { x: noon.x, y: noon.y };
        return null;
      }
      case 'onToll': {
        const st = b.sides[side];
        const charging = b.units.some((f) => f.side === side && f.state === 'ready' && hasMechanic(f.def, 'tollCharge') && f.order.kind === 'attack' && !tollActive(b, f));
        const heavy = b.units.filter((f) => f.side === side && f.engaged > 0).length >= 3;
        return (charging || heavy) && st.tollInterval - st.tollTimer > 8 ? {} : null;
      }
      case 'whenLosing': {
        const mine = b.units.filter((f) => f.side === side && f.state === 'ready' && this.dist(o, f) < 90);
        const shaky = mine.filter((f) => moraleState(f) === 'wavering' || f.light <= 1).length;
        return shaky >= 2 ? {} : null;
      }
      default:
        return null;
    }
  }

  private clusterCandidates(
    b: Battle,
    side: Side,
    u: Unit,
    foes: Unit[],
    def: AbilityDef,
    area: Area | undefined,
    front: boolean,
  ): { x?: number; y?: number; target?: number } | null {
    const o = casterPos(u);
    const script = def.effects.find((e) => e.kind === 'script');
    const name = script && script.kind === 'script' ? script.name : '';
    let radius = 30;
    let shape: 'circle' | 'cone' | 'line' | 'self' = 'circle';
    let angle = Math.PI / 3;
    let reach = def.range ?? 60;
    if (area) {
      if (area.shape === 'circle') {
        radius = area.radius;
        shape = area.at === 'target' ? 'circle' : 'self';
      } else if (area.shape === 'cone') {
        shape = 'cone';
        reach = area.radius;
        angle = (area.angle * Math.PI) / 180;
      } else if (area.shape === 'line') {
        shape = 'line';
        reach = area.length;
        radius = area.width / 2;
      }
    }
    if (name === 'noonLance') {
      shape = 'cone';
      reach = 300;
      angle = Math.PI / 2;
    } else if (name === 'thousandEyes') {
      shape = 'cone';
      reach = 220;
      angle = (120 * Math.PI) / 180;
    } else if (name === 'dive') {
      shape = 'line';
      reach = 70;
      radius = 10;
    } else if (name === 'unveil') {
      shape = 'self';
      radius = 150;
    } else if (name === 'hourThatNeverComes') {
      shape = 'self';
      radius = 120;
    } else if (name === 'gustLeap') {
      // Enemy line downwind within 40 m.
      const tgt = foes.find((e) => this.dist(o, e) < 45 && Math.abs(angleDiff(b.terrain.sunBearing, datan2(e.y - o.y, e.x - o.x))) < 0.6);
      return tgt && u.engaged === 0 ? {} : null;
    } else if (name === 'rammingRun') {
      return null;
    }
    const score = (px: number, py: number, dir: number): number => {
      let enemies = 0;
      let friends = 0;
      for (const t of b.units) {
        if (t.alive <= 0 || t.state === 'dead' || t.state === 'fled' || t.state === 'embarked') continue;
        const d = this.dist(t, shape === 'circle' ? { x: px, y: py } : o);
        if (d > reach + radius + 60) continue;
        let n = 0;
        const stride = t.soldiers.length > 40 ? 4 : 1;
        for (let i = 0; i < t.soldiers.length; i += stride) {
          const s = t.soldiers[i]!;
          if (!s.alive) continue;
          let inside = false;
          if (shape === 'circle') inside = (s.x - px) * (s.x - px) + (s.y - py) * (s.y - py) < radius * radius;
          else if (shape === 'self') inside = (s.x - o.x) * (s.x - o.x) + (s.y - o.y) * (s.y - o.y) < radius * radius;
          else if (shape === 'cone') {
            const dx = s.x - o.x;
            const dy = s.y - o.y;
            inside = dx * dx + dy * dy < reach * reach && Math.abs(angleDiff(dir, datan2(dy, dx))) < angle / 2;
          } else {
            const dx = s.x - o.x;
            const dy = s.y - o.y;
            const along = dx * dcos(dir) + dy * dsin(dir);
            const across = Math.abs(-dx * dsin(dir) + dy * dcos(dir));
            inside = along > 0 && along < reach && across < radius;
          }
          if (inside) n += stride * (s.radius > 1.3 ? 10 : 1);
        }
        if (t.side === side) {
          if (t !== u) friends += n;
        } else enemies += n;
      }
      const friendlyFire = def.effects.some((e) => (e.kind === 'damage' || e.kind === 'knockback') && e.who === 'all') || name === 'hourThatNeverComes';
      return enemies - (friendlyFire ? friends * 1.5 : friends * 0.1);
    };
    const needed = name === 'unveil' ? 120 : name === 'hourThatNeverComes' ? 160 : name === 'thousandEyes' ? 110 : name === 'noonLance' ? 70 : front ? 14 : 40;
    let best: { x: number; y: number; s: number } | null = null;
    for (const e of foes) {
      const d = this.dist(o, e);
      if (shape === 'circle' && d > (def.range ?? 0)) continue;
      if (shape !== 'circle' && d > reach + 20) continue;
      const dir = datan2(e.y - o.y, e.x - o.x);
      const s = score(e.x, e.y, dir);
      if (!best || s > best.s) best = { x: e.x, y: e.y, s };
    }
    if (!best || best.s < needed) return null;
    return { x: best.x, y: best.y };
  }

  // ---------------------------------------------------------------- hours

  private chooseHour(b: Battle, side: Side, mine: Unit[], foes: Unit[]): void {
    const st = b.sides[side];
    if (st.faction !== 'vesperate' || b.tick % 40 !== side * 5) return;
    const chargers = mine.some((u) => (u.def.category === 'cavalry' || u.def.role === 'shock') && u.order.kind === 'attack' && u.engaged === 0 && u.meleeTarget && this.dist(u, u.meleeTarget) < 160);
    const engaged = mine.filter((u) => u.engaged > 0).length;
    const tired = mine.filter((u) => moraleState(u) === 'wavering').length;
    const ringOld = mine.some((u) => u.abilities.some((a) => a.def.id === 'hourThatNeverComes' && a.uses > 0) && foes.some((e) => this.dist(u, e) < 120));
    let hour = st.hour;
    if (ringOld) hour = 'iron';
    else if (chargers) hour = 'charge';
    else if (tired >= 2) hour = 'rest';
    else if (engaged >= 2) hour = 'iron';
    else hour = 'charge';
    if (hour !== st.hour) b.issue(side, { type: 'hour', side, hour }, false);
  }
}

type Ctx = {
  me: { x: number; y: number };
  them: { x: number; y: number };
  dir: number;
  fwd: (u: Unit) => number;
  median: number;
  gap: number;
};

function firstArea(def: AbilityDef): Area | undefined {
  for (const e of def.effects) if ('area' in e && e.area) return e.area;
  return undefined;
}

export function groupOf(u: Unit): Group {
  const r = u.def.role;
  const c = u.def.category;
  if (r === 'colossus') return 'colossus';
  if (r === 'lord') return 'lord';
  if (r === 'hero') return 'hero';
  if (c === 'flyer') return 'flyer';
  if (r === 'artillery') return 'artillery';
  if (r === 'support') return u.def.mechanics?.some((m) => m.kind === 'zone' && m.zone === 'veil') ? 'line' : 'support';
  if (r === 'missileCav') return 'skirmisher';
  if (c === 'cavalry' || c === 'beast') return 'cavalry';
  if (r === 'missile') return 'missile';
  if (c === 'monster') return 'monster';
  return 'line';
}
