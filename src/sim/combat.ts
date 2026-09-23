/**
 * Combat math from the design doc.
 *
 *   P_hit = min(0.90, max(0.08, 0.35 + (MA - MD) / 100))
 *   D     = B (1 - u A / 100) + AP,   u ~ U(0.5, 1)
 *
 * Glare, light, wind and ability modifiers are applied to MA, MD and the
 * damage multipliers before these formulas run.
 */
import type { DamageType, OnHit } from '../data/schema';
import { COMBAT, MORALE } from '../data/rules';
import { angleDiff, clamp, datan2, dcos, dsin, PI } from '../core/dmath';
import type { Rng } from '../core/rng';
import type { Battle } from './battle';
import type { Soldier, Unit } from './types';
import { addZone } from './zones';
import { hasMechanic, mechanic } from './mechanics';

export function hitChance(ma: number, md: number): number {
  return clamp(COMBAT.hitBase + (ma - md) / 100, COMBAT.hitMin, COMBAT.hitMax);
}

export function armorRoll(rng: Rng, base: number, ap: number, armor: number): number {
  const u = rng.range(COMBAT.armorRollMin, COMBAT.armorRollMax);
  return Math.max(0, base * (1 - (u * clamp(armor, 0, 100)) / 100)) + ap;
}

/** Split a bonus between base and armor-piercing parts in their ratio. */
export function addSplit(base: number, ap: number, bonus: number): [number, number] {
  const total = base + ap;
  if (total <= 0) return [base + bonus, ap];
  return [base + (bonus * base) / total, ap + (bonus * ap) / total];
}

/** Damage-type multipliers: Brittle, fire vulnerability, colossus weak points. */
export function typeMult(type: DamageType | undefined, target: Unit): number {
  let m = 1;
  if ((type === 'cold' || type === 'resonance') && hasMechanic(target.def, 'brittle')) m *= COMBAT.brittleMult;
  if (type === 'fire') {
    const fv = mechanic(target.def, 'fireVulnerable');
    if (fv) m *= 1 + fv.pct / 100;
  }
  return m;
}

export function isBig(s: Soldier): boolean {
  return s.radius >= 2;
}

/**
 * Apply damage to a soldier. Returns true when it died.
 * `from` is the attacking soldier when there is one (melee and missiles).
 */
export function applyDamage(
  b: Battle,
  t: Soldier,
  dmg: number,
  from: Soldier | null,
  type: DamageType | undefined,
  fromUnit: Unit | null,
): boolean {
  if (!t.alive || dmg <= 0) return false;
  const tu = t.unit;
  dmg *= tu.stats.damageTakenMult;
  // Old Midnight: hits from the front land on its elk team first.
  if (tu.special.elkHp !== undefined && tu.special.elkHp > 0 && from) {
    const dir = datan2(from.y - t.y, from.x - t.x);
    if (Math.abs(angleDiff(tu.facing, dir)) < 1.1) {
      tu.special.elkHp -= dmg;
      tu.damageTaken += dmg;
      if (fromUnit) fromUnit.damageDealt += dmg;
      if (tu.special.elkHp <= 0) {
        tu.special.elkHp = 0;
        b.events.push({ t: 'text', x: t.x, y: t.y, text: 'Elk team down', side: tu.side });
      }
      return false;
    }
  }
  // The Nailbearer's open chest during Noon Lance: double damage from the front.
  if (tu.special.coreExposed && from) {
    const dir = datan2(from.y - t.y, from.x - t.x);
    if (Math.abs(angleDiff(t.facing, dir)) < 1.2) dmg *= 2;
  }
  // Fire sets the Dreadsail's sails alight.
  if (type === 'fire' && hasMechanic(tu.def, 'sailing') && !tu.special.sailsBurning) {
    tu.special.sailsBurning = 1;
    tu.special.sailsUntil = b.time + 20;
    b.events.push({ t: 'text', x: t.x, y: t.y, text: 'Sails alight!', side: tu.side });
  }
  t.hp -= dmg;
  tu.damageTaken += dmg;
  if (fromUnit) fromUnit.damageDealt += dmg;
  if (t.hp <= 0) {
    killSoldier(b, t, from, fromUnit);
    return true;
  }
  return false;
}

export function killSoldier(b: Battle, t: Soldier, from: Soldier | null, fromUnit: Unit | null): void {
  if (!t.alive) return;
  const tu = t.unit;
  t.alive = false;
  t.hp = 0;
  t.target = null;
  t.approach = null;
  tu.alive--;
  tu.slotsDirty = true;
  tu.lastLossTime = b.time;
  tu.losses[Math.floor(b.time) % tu.losses.length]! += 1;
  // Casualty shock: losing the whole unit would cost MORALE.casualtyShock % of max morale.
  tu.morale -= ((MORALE.casualtyShock / 100) * tu.maxMorale) / Math.max(1, tu.initial);
  if (from) from.kills++;
  if (fromUnit) fromUnit.kills++;
  const big = isBig(t);
  b.events.push({ t: 'death', x: t.x, y: t.y, unit: tu.id, big });
  if (t.leader && tu.isGeneral) b.generalDied(tu.side, t);
  if (tu.alive <= 0) {
    tu.alive = 0;
    tu.state = 'dead';
    for (const p of tu.passengers) b.disembark(p, true);
    if (tu.def.category === 'colossus') b.colossusFell(tu);
  }
}

export function knockDown(b: Battle, t: Soldier, dirX: number, dirY: number, dist: number, time: number): void {
  const tu = t.unit;
  if (tu.stats.noKnockback || !t.alive) return;
  if (tu.def.category === 'colossus') {
    if (b.time < tu.stunLock) return;
    tu.stunLock = b.time + COMBAT.colossusStunLockout;
    time = Math.min(time, 1.2);
    dist = Math.min(dist, 1.5);
  }
  t.downTimer = Math.max(t.downTimer, time);
  t.target = null;
  t.vx = dirX * dist * 2.2;
  t.vy = dirY * dist * 2.2;
}

export function staggerSoldier(b: Battle, t: Soldier, time: number): void {
  const tu = t.unit;
  if (tu.def.category === 'colossus') {
    if (b.time < tu.stunLock) return;
    tu.stunLock = b.time + COMBAT.colossusStunLockout;
  }
  t.staggerTimer = Math.max(t.staggerTimer, time);
  t.atkTimer = Math.max(t.atkTimer, time);
}

/** Ground a flying unit for a while (harpoons, resonance). */
export function groundFlyer(b: Battle, tu: Unit, time: number): void {
  if (!hasMechanic(tu.def, 'flyer')) return;
  if (tu.def.category === 'colossus') {
    if (b.time < tu.stunLock) return;
    tu.stunLock = b.time + COMBAT.colossusStunLockout;
  }
  if (tu.grounded <= 0) b.events.push({ t: 'text', x: tu.x, y: tu.y, text: 'Grounded', side: tu.side });
  tu.grounded = Math.max(tu.grounded, time);
  for (const s of tu.soldiers) s.airborne = false;
}

export function applyOnHit(b: Battle, effects: OnHit[] | undefined, t: Soldier, fromUnit: Unit, x: number, y: number): void {
  if (!effects || !t) return;
  const tu = t.unit;
  for (const e of effects) {
    switch (e.kind) {
      case 'chill':
        tu.chill = Math.max(tu.chill, COMBAT.chill.duration);
        break;
      case 'burn':
        // While a burn lasts the hotter fire wins; a burn that has gone out is forgotten.
        t.burnDps = t.burn > 0 ? Math.max(t.burnDps, e.dps) : e.dps;
        t.burn = Math.max(t.burn, e.duration);
        break;
      case 'stagger':
        if (t.alive) staggerSoldier(b, t, e.duration);
        break;
      case 'knockdown':
        if (t.alive && b.rng.chance(e.chance)) {
          const a = datan2(t.y - y, t.x - x);
          knockDown(b, t, dcos(a), dsin(a), 1.5, 1.2);
        }
        break;
      case 'leadership':
        if (!tu.stats.fearImmune || e.pct > 0) tu.morale -= (e.pct / 100) * tu.maxMorale;
        break;
      case 'mark':
        tu.marked = Math.max(tu.marked, e.duration);
        break;
      case 'slow':
        if (e.largeOnly && tu.def.size === 'small') break;
        // Check the old slow before extending it: while one is active the stronger wins, an expired one is forgotten.
        tu.slowPct = tu.slow > 0 ? Math.max(tu.slowPct, e.pct) : e.pct;
        tu.slow = Math.max(tu.slow, e.duration);
        if (e.grounds) groundFlyer(b, tu, 6);
        break;
      case 'swallow':
        if (t.alive && tu.def.size === 'small' && b.rng.chance(e.chance)) {
          killSoldier(b, t, null, fromUnit);
        }
        break;
      case 'lightZone':
        addZone(b, e.zone, fromUnit.side, x, y, e.duration);
        break;
    }
  }
}

/** Fear from ambushes and silent charges: -15% leadership for 10 s. */
export function applyFear(b: Battle, tu: Unit, pct: number, duration: number): void {
  if (tu.stats.fearImmune) return;
  tu.morale -= (pct / 100) * tu.maxMorale * 0.6;
  tu.buffs.push({ mods: { leadershipPct: -pct }, until: b.time + duration, tag: 'fear' });
}

/** Angle between a target soldier's facing and the direction to its attacker. */
export function attackAngle(t: Soldier, fromX: number, fromY: number): number {
  const dir = datan2(fromY - t.y, fromX - t.x);
  return Math.abs(angleDiff(t.facing, dir));
}

export const FLANK_ANGLE = (70 * PI) / 180;
export const REAR_ANGLE = (125 * PI) / 180;
