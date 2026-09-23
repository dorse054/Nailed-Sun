/**
 * Melee: soldiers pair off into duels on contact. Charges hit first and hard;
 * braced spears and hooks blunt them; flank and rear attacks ignore part of
 * the defender's melee defense and drain morale.
 */
import { COMBAT } from '../data/rules';
import { angleDiff, datan2, dcos, dsin } from '../core/dmath';
import type { Battle } from './battle';
import { DT } from './constants';
import type { Soldier, Unit } from './types';
import {
  addSplit,
  applyDamage,
  applyFear,
  applyOnHit,
  armorRoll,
  attackAngle,
  FLANK_ANGLE,
  hitChance,
  killSoldier,
  knockDown,
  REAR_ANGLE,
  typeMult,
} from './combat';
import { hasMechanic, mechanic } from './mechanics';
import { nearestSoldier, reachOf } from './movement';

/**
 * How many soldiers can fight one big body (monster, colossus, engine, flyer) at
 * once: one ring of attackers around it, a formation's spacing apart. The rest
 * of a crowd waits its turn behind them.
 */
export function meleeSlots(o: Soldier): number {
  return Math.max(4, Math.round((2 * Math.PI * (o.radius + 0.45)) / MELEE_SLOT_SPACING));
}
const MELEE_SLOT_SPACING = 1.25;

/** Count each big body's melee attackers; soldiers beyond its slots let go of it. */
function countAttackers(b: Battle): void {
  const bigs = b.bigSoldiers;
  for (let i = 0; i < bigs.length; i++) bigs[i]!.attackers = 0;
  const soldiers = b.soldiers;
  for (let i = 0; i < soldiers.length; i++) {
    const s = soldiers[i]!;
    const t = s.target;
    if (!t || !s.alive || t.radius <= 1.3) continue;
    if (t.attackers >= meleeSlots(t)) {
      s.target = null;
      continue;
    }
    t.attackers++;
  }
}

export function updateMelee(b: Battle): void {
  const soldiers = b.soldiers;
  for (const u of b.units) {
    u.engaged = 0;
    const fp = u.special.flankP;
    if (fp) u.special.flankP = fp * 0.96;
    const rp = u.special.rearP;
    if (rp) u.special.rearP = rp * 0.96;
  }
  countAttackers(b);
  // Soldiers only look for opponents when some enemy unit is close.
  if (b.tick % 4 === 0) markNearEnemies(b);
  for (let i = 0; i < soldiers.length; i++) {
    const s = soldiers[i]!;
    if (!s.alive) continue;
    const u = s.unit;
    if (u.state !== 'ready') {
      s.target = null;
      s.approach = null;
      s.charging = false;
      continue;
    }
    if (s.downTimer > 0) continue;
    if (u.withdrawing) {
      s.target = null;
      continue;
    }
    let t = s.target;
    const reach = reachOf(b, s);
    if (t) {
      if (!t.alive || t.unit.state === 'fled' || t.unit.state === 'embarked' || (t.airborne && !s.airborne)) {
        s.target = null;
        t = null;
      } else {
        const dx = t.x - s.x;
        const dy = t.y - s.y;
        const contact = s.radius + t.radius + reach;
        if (dx * dx + dy * dy > (contact + 1.5) * (contact + 1.5)) {
          s.target = null;
          t = null;
        }
      }
    }
    if (!t && (u.special.near || s.charging)) {
      s.seek--;
      if (s.seek <= 0) {
        s.seek = 3 + (s.id & 3);
        search(b, s, reach);
        t = s.target;
      }
    } else if (!t && s.approach) {
      // No enemy near the unit any more: stop chasing and fall back into formation.
      s.approach = null;
    }
    if (!t) continue;
    u.engaged++;
    u.lastMeleeTime = b.time;
    const dx = t.x - s.x;
    const dy = t.y - s.y;
    const contact = s.radius + t.radius + reach + 0.3;
    if (dx * dx + dy * dy > contact * contact) continue;
    if (s.charging) {
      s.charging = false;
      impact(b, s, t);
      if (!s.target || !t.alive) continue;
    }
    if (s.staggerTimer > 0) continue;
    if (u.special.disorderUntil !== undefined && b.time < u.special.disorderUntil) continue;
    s.atkTimer -= DT * u.stats.attackSpeedMult * u.entityScale;
    if (s.atkTimer <= 0) {
      meleeAttack(b, s, t, 0);
      const w = weaponOf(s);
      s.atkTimer = w.interval * (0.85 + b.rng.next() * 0.3);
    }
  }
}

function markNearEnemies(b: Battle): void {
  const us = b.units;
  for (const u of us) {
    u.special.near = 0;
    if (u.alive <= 0 || u.state === 'dead' || u.state === 'fled') continue;
    const ru = unitRadius(u);
    for (const e of us) {
      if (e.side === u.side || e.alive <= 0 || e.state === 'dead' || e.state === 'fled' || e.state === 'embarked') continue;
      const lim = ru + unitRadius(e) + 25;
      const dx = e.x - u.x;
      const dy = e.y - u.y;
      if (dx * dx + dy * dy < lim * lim) {
        u.special.near = 1;
        break;
      }
    }
  }
}

/** Rough radius of the area a unit's soldiers occupy. */
function unitRadius(u: Unit): number {
  if (u.state === 'routing' || u.state === 'shattered') return 60;
  if (u.def.category === 'colossus') return (u.def.radius ?? 8) + 4;
  const n = u.alive;
  const spread = u.def.category === 'cavalry' ? 2.8 : u.def.category === 'monster' ? 7 : u.def.category === 'artillery' ? 13 : 1.4;
  return Math.max(8, Math.sqrt(n) * spread * 1.2) + (u.engaged > 0 ? 12 : 0);
}

function weaponOf(s: Soldier) {
  const def = s.unit.def;
  return s.leader && def.leader ? def.leader.weapon : def.weapon;
}

function search(b: Battle, s: Soldier, reach: number): void {
  const u = s.unit;
  const pref = u.meleeTarget;
  let best: Soldier | null = null;
  let bestScore = Infinity;
  const r = s.radius + reach + 1.4;
  b.hash.query(s.x, s.y, r, (j) => {
    const o = b.soldiers[j]!;
    if (!o.alive || o.unit.side === u.side || o.radius > 1.3) return;
    if (o.unit.state === 'embarked' || o.unit.state === 'fled') return;
    if (o.airborne && !s.airborne) return;
    const dx = o.x - s.x;
    const dy = o.y - s.y;
    const d = Math.sqrt(dx * dx + dy * dy) - o.radius - s.radius;
    if (d > reach + 0.25) return;
    const score = d + (pref && o.unit !== pref ? 1.2 : 0) + (o.unit.state === 'routing' ? 0.5 : 0);
    if (score < bestScore) {
      bestScore = score;
      best = o;
    }
  });
  for (const o of b.bigSoldiers) {
    if (!o.alive || o.unit.side === u.side || o.unit.state === 'embarked') continue;
    if (o.airborne && !s.airborne) continue;
    // Every place around it is taken.
    if (o.attackers >= meleeSlots(o)) continue;
    const dx = o.x - s.x;
    const dy = o.y - s.y;
    const d = Math.sqrt(dx * dx + dy * dy) - o.radius - s.radius;
    if (d > reach + 0.25) continue;
    const score = d + (pref && o.unit !== pref ? 1.2 : 0);
    if (score < bestScore) {
      bestScore = score;
      best = o;
    }
  }
  if (best) {
    const chosen = best as Soldier;
    s.target = chosen;
    s.approach = null;
    if (chosen.radius > 1.3) chosen.attackers++;
    return;
  }
  // Close with the enemy: charging soldiers run at the target unit, others join the fight nearby.
  const fighting = pref !== null || (u.engaged > 0 && u.order.kind !== 'move');
  if (!fighting && !s.charging) {
    s.approach = null;
    return;
  }
  // Frontage: only the front ranks of a block step out to find an opponent. The ranks behind
  // keep formation, fight whoever comes within reach (a flank or rear attack) and step up as
  // the front rank falls, so a wider line or a flank attack brings more soldiers to bear.
  if (u.formation === 'block' && frontRank(u, s) >= FRONT_RANKS) {
    s.approach = null;
    return;
  }
  // Soldiers only run after routers when their unit was sent after that unit: otherwise a
  // formation dissolves into a stream of pursuers and its anchor can no longer move.
  const chases = (o: Soldier): boolean => (o.unit.state !== 'routing' && o.unit.state !== 'shattered') || o.unit === pref;
  if (s.approach && s.approach.alive && s.approach.unit.state !== 'fled' && chases(s.approach)) {
    const dx = s.approach.x - s.x;
    const dy = s.approach.y - s.y;
    if (dx * dx + dy * dy < 30 * 30) return;
  }
  let near: Soldier | null = null;
  let nd = Infinity;
  const rr = s.charging ? 20 : 12;
  b.hash.query(s.x, s.y, rr, (j) => {
    const o = b.soldiers[j]!;
    if (!o.alive || o.unit.side === u.side || o.unit.state === 'embarked') return;
    if (o.airborne && !s.airborne) return;
    if (!chases(o)) return;
    const dx = o.x - s.x;
    const dy = o.y - s.y;
    const d = dx * dx + dy * dy + (pref && o.unit !== pref ? 64 : 0);
    if (d < nd) {
      nd = d;
      near = o;
    }
  });
  if (!near && pref && (s.charging || u.order.kind === 'attack')) {
    const cand = nearestSoldier(pref, s.x, s.y);
    const lim = s.charging ? 30 : 20;
    if (cand && (cand.x - s.x) * (cand.x - s.x) + (cand.y - s.y) * (cand.y - s.y) < (lim + cand.radius) * (lim + cand.radius)) near = cand;
  }
  // Only break formation to close on someone we can actually walk to.
  const n = near as Soldier | null;
  if (n && !s.airborne && !straightClear(b, s, n)) near = null;
  s.approach = near;
}

/** Ranks of a block that press forward into melee. */
export const FRONT_RANKS = 2;

/** Which rank of its block a soldier stands in (0 = front), from its formation slot. */
export function frontRank(u: Unit, s: Soldier): number {
  const files = Math.max(1, Math.min(u.files, u.alive));
  return Math.floor(s.slot / files);
}

function straightClear(b: Battle, s: Soldier, t: Soldier): boolean {
  const dx = t.x - s.x;
  const dy = t.y - s.y;
  const d = Math.sqrt(dx * dx + dy * dy);
  const steps = Math.ceil(d / 2.5);
  const cat = s.unit.def.category;
  for (let k = 1; k < steps; k++) {
    const f = k / steps;
    if (!b.terrain.passable(s.x + dx * f, s.y + dy * f, cat)) return false;
  }
  return true;
}

/** Brace against a charge: stationary, facing it (rings face every way). */
function braceValue(t: Unit, from: Soldier): number {
  if (t.moving) return 0;
  let v = 0;
  for (const a of t.abilities) if (a.def.kind === 'toggle' && a.on && a.def.stance?.brace) v = Math.max(v, a.def.stance.brace);
  const bb = mechanic(t.def, 'braceBonus');
  if (bb) v = Math.max(v, bb.value);
  if (v <= 0) return 0;
  if (t.formation !== 'ring') {
    const dir = datan2(from.y - t.y, from.x - t.x);
    if (Math.abs(angleDiff(t.facing, dir)) > 1.4) return 0;
  }
  return from.unit.def.size === 'small' ? v * 0.5 : v;
}

function impact(b: Battle, s: Soldier, t: Soldier): void {
  const u = s.unit;
  const tu = t.unit;
  const sp = Math.sqrt(s.vx * s.vx + s.vy * s.vy);
  if (sp < 0.45 * u.def.speed) return;
  let cb = u.chargeValue;
  let brace = braceValue(tu, s);
  if (brace > 0) {
    // Leaping Charge: downwind charges ignore half the target's brace bonus.
    if (hasMechanic(u.def, 'leapingCharge') && Math.abs(angleDiff(datan2(s.vy, s.vx), b.terrain.sunBearing)) < 1.05) brace *= 0.5;
    cb = Math.max(0, cb - brace);
    meleeAttack(b, t, s, brace * 0.5);
    s.vx *= 0.2;
    s.vy *= 0.2;
  }
  // Hooks cancel the charge of any large, but not colossal, unit on impact.
  if (hasMechanic(tu.def, 'hooks') && u.def.size === 'large') {
    cb = 0;
    s.vx *= 0.1;
    s.vy *= 0.1;
    if (b.time - (u.special.hookedAt ?? -99) > 4) {
      u.special.hookedAt = b.time;
      b.events.push({ t: 'text', x: s.x, y: s.y, text: 'Hooked!', side: tu.side });
    }
  }
  s.cb = cb;
  s.chargeTimer = cb > 0 ? COMBAT.chargeDuration : 0;
  if (!s.alive) return;
  // Knockback from momentum.
  const power = s.mass * sp * (1 + cb / 40);
  const resist = t.mass * 6 * (brace > 0 ? 3 : 1);
  if (power > resist && !tu.stats.noKnockback) {
    const dx = s.vx / sp;
    const dy = s.vy / sp;
    knockDown(b, t, dx, dy, Math.min(4, 1 + (power / resist - 1) * 0.6), 1.1 + b.rng.next() * 0.8);
  }
  if (b.time - (u.special.impactAt ?? -99) > 3) {
    u.special.impactAt = b.time;
    b.events.push({ t: 'charge', x: t.x, y: t.y, unit: u.id, power: cb });
    // Silent Charge: a charge from stealth causes fear.
    if (u.special.stealthCharge && hasMechanic(u.def, 'silentCharge')) {
      applyFear(b, tu, 15, 10);
      b.events.push({ t: 'text', x: t.x, y: t.y, text: 'Silent charge!', side: u.side });
    }
    u.special.stealthCharge = 0;
  }
  meleeAttack(b, s, t, 0);
}

export function meleeAttack(b: Battle, s: Soldier, t: Soldier, maBonus: number): void {
  const u = s.unit;
  const tu = t.unit;
  if (!s.alive || !t.alive) return;
  const w = weaponOf(s);
  let flankKind = 0;
  if (tu.formation !== 'ring' && tu.def.category !== 'colossus') {
    const ang = attackAngle(t, s.x, s.y);
    flankKind = ang > REAR_ANGLE ? 2 : ang > FLANK_ANGLE ? 1 : 0;
    if (flankKind === 1) tu.special.flankP = Math.min(1, (tu.special.flankP ?? 0) + 0.035);
    else if (flankKind === 2) tu.special.rearP = Math.min(1, (tu.special.rearP ?? 0) + 0.05);
  }
  const mdMult = flankKind === 2 ? COMBAT.rearMdMult : flankKind === 1 ? COMBAT.flankMdMult : 1;
  const cbNow = s.chargeTimer > 0 ? s.cb * (s.chargeTimer / COMBAT.chargeDuration) : 0;
  let ma = (s.ma + u.stats.ma + u.stats.glareMa) * u.stats.maMult + cbNow + maBonus;
  let md = (t.md + tu.stats.md) * tu.stats.mdMult * mdMult;
  if (u.special.disorderUntil !== undefined && b.time < u.special.disorderUntil) ma *= 0.7;
  if (tu.special.disorderUntil !== undefined && b.time < tu.special.disorderUntil) md *= 0.7;
  if (t.downTimer > 0) md *= 0.5;
  if (tu.state === 'routing' || tu.state === 'shattered') md *= 0.25;
  const hit = b.rng.next() < hitChance(ma, md);
  const mc = mechanic(tu.def, 'moltenCore');
  if (hit) {
    let base = w.base;
    let ap = w.ap;
    if (tu.def.size !== 'small' && w.vsLarge) [base, ap] = addSplit(base, ap, w.vsLarge);
    if (tu.def.category === 'infantry' && w.vsInfantry) [base, ap] = addSplit(base, ap, w.vsInfantry);
    if (cbNow > 0) [base, ap] = addSplit(base, ap, cbNow * 0.8);
    let dmg = armorRoll(b.rng, base, ap, t.armor + tu.stats.armorAdd) * u.stats.dmgMult * typeMult(w.type, tu);
    const amb = mechanic(u.def, 'ambush');
    if (amb && s.ambush && u.special.ambushReady) {
      dmg *= 1 + amb.dmgPct / 100;
      s.ambush = false;
      if (amb.fear && !tu.special.feared) {
        applyFear(b, tu, 15, 10);
        tu.special.feared = 1;
      }
    }
    if (tu.marked > 0 && hasMechanic(u.def, 'stealth')) dmg *= 1 + Math.max(10, tu.stats.markedPct) / 100;
    const vr = mechanic(u.def, 'vsRouting');
    if (vr && tu.state === 'routing') dmg *= 1 + vr.pct / 100;
    const vm = mechanic(u.def, 'vsMissile');
    if (vm && tu.def.role === 'missile') dmg *= 1 + vm.pct / 100;
    const dtf = mechanic(u.def, 'drawnToFlame');
    if (dtf && b.zones.some((z) => z.source === tu && z.def.light && z.def.light.mode === 'floor' && z.def.light.intensity >= 2)) {
      dmg *= 1 + dtf.dmgPct / 100;
    }
    u.meleeDealt += dmg;
    tu.meleeTaken += dmg;
    applyDamage(b, t, dmg, s, w.type, u);
    applyOnHit(b, w.onHit, t, u, t.x, t.y);
    const mk = mechanic(u.def, 'marks');
    if (mk) tu.marked = Math.max(tu.marked, 8);
    // Big bodies bowl over small ones.
    if (t.alive && u.def.size !== 'small' && tu.def.size === 'small' && s.mass > t.mass * 8 && b.rng.next() < 0.22) {
      const a = datan2(t.y - s.y, t.x - s.x);
      knockDown(b, t, dcos(a), dsin(a), 1.4, 1);
    }
  }
  // Molten Core: melee attackers take splash fire damage.
  if (mc && s.alive) applyDamage(b, s, mc.damage * (hit ? 1 : 0.4), null, 'fire', tu);
  // Large attackers hit several soldiers per swing.
  if (w.splash && w.splash.targets > 1) splash(b, s, t, w.splash.targets - 1, w.splash.radius, ma);
}

function splash(b: Battle, s: Soldier, primary: Soldier, extra: number, radius: number, ma: number): void {
  const u = s.unit;
  const w = weaponOf(s);
  let left = extra;
  const cx = primary.x;
  const cy = primary.y;
  const victims: Soldier[] = [];
  b.hash.query(cx, cy, radius + 1.5, (j) => {
    if (left <= 0) return true;
    const o = b.soldiers[j]!;
    if (o === primary || !o.alive || o.unit.side === u.side || o.unit.state === 'embarked') return;
    if (o.airborne && !s.airborne) return;
    victims.push(o);
    left--;
    return left <= 0;
  });
  for (const o of victims) {
    const tu = o.unit;
    const md = (o.md + tu.stats.md) * tu.stats.mdMult * (o.downTimer > 0 ? 0.5 : 1);
    if (b.rng.next() >= hitChance(ma, md)) continue;
    let base = w.base;
    let ap = w.ap;
    if (tu.def.size !== 'small' && w.vsLarge) [base, ap] = addSplit(base, ap, w.vsLarge);
    if (tu.def.category === 'infantry' && w.vsInfantry) [base, ap] = addSplit(base, ap, w.vsInfantry);
    const dmg = armorRoll(b.rng, base, ap, o.armor + tu.stats.armorAdd) * u.stats.dmgMult * typeMult(w.type, tu) * 0.8;
    u.meleeDealt += dmg;
    tu.meleeTaken += dmg;
    applyDamage(b, o, dmg, s, w.type, u);
    applyOnHit(b, w.onHit, o, u, o.x, o.y);
    if (o.alive && tu.def.size === 'small' && s.mass > o.mass * 8 && b.rng.next() < 0.3) {
      const a = datan2(o.y - s.y, o.x - s.x);
      knockDown(b, o, dcos(a), dsin(a), 1.6, 1);
    }
  }
}

/** Damage over time: burning soldiers and Burning Faith. Runs twice a second. */
export function updateStatus(b: Battle): void {
  if (b.tick % 10 !== 5) return;
  for (const u of b.units) {
    if (u.state === 'dead' || u.state === 'fled') continue;
    const bf = mechanic(u.def, 'burningFaith');
    const engaged = u.engaged > 0;
    for (const s of u.soldiers) {
      if (!s.alive) continue;
      if (s.burn > 0 && s.burnDps > 0) applyDamage(b, s, s.burnDps * 0.5, null, 'fire', null);
      // Burning Faith: lose 1% HP per second in combat.
      if (bf && engaged && s.alive) {
        s.hp -= s.maxHp * (bf.hpLossPct / 100) * 0.5;
        if (s.hp <= 0) killSoldier(b, s, null, null);
      }
    }
  }
}
