/**
 * The duel harness: the stock scripted BattleAI plays each side, plus one
 * anti-stall rule.
 *
 * The battle AI is written for whole armies. Alone on a field some units
 * never engage: cavalry guards a wing until the "lines" meet (a lone unit
 * has no line), artillery only creeps forward behind a line, and support
 * units keep their distance. So when nothing has happened for a while (no
 * damage dealt and the two sides have not closed in), every idle unit on the
 * side gets an attack order on the nearest enemy, and for a few seconds the
 * battle AI may not move or halt it. Missile units given an attack order close
 * to range and shoot; melee units charge. Both sides use exactly the same
 * controller, so the duel stays symmetric.
 */
import { BattleAI } from '../ai/battleAI';
import type { Battle, Controller } from '../sim/battle';
import type { Command, Side, Unit } from '../sim/types';

export interface DuelAIOptions {
  /** Seconds without damage or closing distance before idle units are sent in. */
  stallSeconds?: number;
  /** Seconds a forced attack order is protected from the battle AI's move and halt orders. */
  forceSeconds?: number;
}

export class DuelAI implements Controller {
  private readonly inner = new BattleAI();
  private readonly stallSeconds: number;
  private readonly forceSeconds: number;
  /** Unit id -> time until which the battle AI may not move or halt it. */
  private readonly forced = new Map<number, number>();
  private lastProgress = 0;
  private lastDamage = 0;
  private bestGap = Infinity;
  /** Number of forced attack orders issued (reported for transparency). */
  forcedOrders = 0;

  constructor(opts: DuelAIOptions = {}) {
    this.stallSeconds = opts.stallSeconds ?? 20;
    this.forceSeconds = opts.forceSeconds ?? 15;
  }

  update(b: Battle, side: Side): void {
    const now = b.time;
    for (const [id, until] of this.forced) {
      const u = b.units[id];
      if (!u || now >= until || u.state !== 'ready' || u.engaged > 0 || now - u.lastFireTime < 1) this.forced.delete(id);
    }
    // The battle AI plays as usual, except that it may not pull a forced unit back.
    const original = b.issue;
    const forced = this.forced;
    b.issue = (s: Side, cmd: Command, record?: boolean) => {
      if ((cmd.type === 'move' || cmd.type === 'halt' || cmd.type === 'withdraw') && forced.has(cmd.unit)) return;
      original.call(b, s, cmd, record);
    };
    try {
      this.inner.update(b, side);
    } finally {
      b.issue = original;
    }
    if (this.stalled(b)) this.sendIn(b, side);
  }

  /** True when neither side has dealt damage nor closed in for stallSeconds. */
  private stalled(b: Battle): boolean {
    let damage = 0;
    for (const u of b.units) damage += u.damageDealt;
    const gap = closestGap(b);
    if (damage > this.lastDamage + 1e-6 || gap < this.bestGap - 5) {
      this.lastProgress = b.time;
      this.lastDamage = damage;
      this.bestGap = Math.min(this.bestGap, gap);
    }
    return b.time - this.lastProgress > this.stallSeconds;
  }

  private sendIn(b: Battle, side: Side): void {
    const foes = b.units.filter((e) => e.side !== side && e.state === 'ready' && e.alive > 0);
    if (!foes.length) return;
    for (const u of b.units) {
      if (u.side !== side || u.state !== 'ready' || u.alive <= 0 || u.engaged > 0) continue;
      if (this.forced.has(u.id) || b.time - u.lastFireTime < 4) continue;
      const t = nearest(b, u, foes, side);
      if (!t) continue;
      this.forced.set(u.id, b.time + this.forceSeconds);
      this.forcedOrders++;
      if (t.visible[side] || b.time - t.lastSeen[side] < 8) {
        b.issue(side, { type: 'attack', unit: u.id, target: t.id, run: true }, false);
      } else {
        // An attack order on an unseen unit lapses at once: march on it until it shows.
        const facing = Math.atan2(t.y - u.y, t.x - u.x);
        b.issue(side, { type: 'move', unit: u.id, x: t.x, y: t.y, facing, run: true }, false);
      }
    }
    // Give the next stall a fresh window.
    this.lastProgress = b.time;
  }
}

/** Nearest enemy, preferring ones this side can see (orders on unseen targets lapse). */
function nearest(b: Battle, u: Unit, foes: Unit[], side: Side): Unit | null {
  let best: Unit | null = null;
  let bd = Infinity;
  for (const e of foes) {
    const seen = e.visible[side] || b.time - e.lastSeen[side] < 8;
    const d = (e.x - u.x) * (e.x - u.x) + (e.y - u.y) * (e.y - u.y) + (seen ? 0 : 1e12);
    if (d < bd) {
      bd = d;
      best = e;
    }
  }
  return best;
}

/** Smallest distance between two opposing fighting units' anchors. */
function closestGap(b: Battle): number {
  let best = Infinity;
  for (const a of b.units) {
    if (a.side !== 0 || a.state !== 'ready' || a.alive <= 0) continue;
    for (const e of b.units) {
      if (e.side !== 1 || e.state !== 'ready' || e.alive <= 0) continue;
      const d = Math.sqrt((a.x - e.x) * (a.x - e.x) + (a.y - e.y) * (a.y - e.y));
      if (d < best) best = d;
    }
  }
  return best;
}
