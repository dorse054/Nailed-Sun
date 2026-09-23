/**
 * Effective unit stats, rebuilt every tick.
 *
 * Order: zone auras, timed buffs, stances, faction traits and unit passives
 * (gated by light, wind, movement...), the Vesperate Hour during a Toll,
 * status effects, fatigue, then glare.
 */
import type { Conditions, LightLevel, StatMods } from '../data/schema';
import { ARTIFICIAL_GLARE, FATIGUE, GLARE_HALF_ANGLE_DEG, LIGHT_RULES } from '../data/rules';
import { factionDef } from '../data/index';
import { angleDiff, datan2, DEG } from '../core/dmath';
import type { Battle } from './battle';
import type { Unit, UnitStats } from './types';
import { darkWinsAt, lightAt, windAt } from './zones';
import { hasMechanic, mechanic } from './mechanics';

const GLARE_ANGLE = GLARE_HALF_ANGLE_DEG * DEG;

export function applyMods(s: UnitStats, m: StatMods, scale = 1): void {
  if (m.ma) s.ma += m.ma * scale;
  if (m.md) s.md += m.md * scale;
  if (m.maPct) s.maMult += (m.maPct / 100) * scale;
  if (m.mdPct) s.mdMult += (m.mdPct / 100) * scale;
  if (m.dmgPct) s.dmgMult += (m.dmgPct / 100) * scale;
  if (m.missileDmgPct) s.missileDmgMult += (m.missileDmgPct / 100) * scale;
  if (m.accuracyPct) s.accuracyMult += (m.accuracyPct / 100) * scale;
  if (m.rangePct) s.rangeMult += (m.rangePct / 100) * scale;
  if (m.reloadPct) s.reloadMult += (m.reloadPct / 100) * scale;
  if (m.speedPct) s.speedMult += (m.speedPct / 100) * scale;
  if (m.attackSpeedPct) s.attackSpeedMult += (m.attackSpeedPct / 100) * scale;
  if (m.chargeBonus) s.chargeBonus += m.chargeBonus * scale;
  if (m.leadershipPct) s.leadershipMult += (m.leadershipPct / 100) * scale;
  if (m.moraleRegen) s.moraleRegen += m.moraleRegen * scale;
  if (m.moraleDrain) s.moraleDrain += m.moraleDrain * scale;
  if (m.missileBlock) s.missileBlock += m.missileBlock * scale;
  if (m.armor) s.armorAdd += m.armor * scale;
  if (m.damageTakenPct) s.damageTakenMult += (m.damageTakenPct / 100) * scale;
  if (m.fatigueRatePct) s.fatigueRateMult += (m.fatigueRatePct / 100) * scale;
  if (m.fatigueRecoveryPct) s.fatigueRecoveryMult += (m.fatigueRecoveryPct / 100) * scale;
  if (m.spotPct) s.spotMult += (m.spotPct / 100) * scale;
  if (m.markedPct) s.markedPct += m.markedPct * scale;
  if (m.noKnockback) s.noKnockback = true;
  if (m.unbreakable) s.unbreakable = true;
  if (m.fearImmune) s.fearImmune = true;
  if (m.ignoreDarkness) s.ignoreDarkness = true;
  if (m.noFatigue) s.noFatigue = true;
  if (m.forceHidden) s.forceHidden = true;
  if (m.revealed) s.revealed = true;
}

function resetStats(s: UnitStats): void {
  s.ma = 0;
  s.md = 0;
  s.maMult = 1;
  s.mdMult = 1;
  s.dmgMult = 1;
  s.missileDmgMult = 1;
  s.accuracyMult = 1;
  s.rangeMult = 1;
  s.reloadMult = 1;
  s.speedMult = 1;
  s.attackSpeedMult = 1;
  s.chargeBonus = 0;
  s.leadershipMult = 1;
  s.moraleRegen = 0;
  s.moraleDrain = 0;
  s.missileBlock = 0;
  s.armorAdd = 0;
  s.damageTakenMult = 1;
  s.fatigueRateMult = 1;
  s.fatigueRecoveryMult = 1;
  s.spotMult = 1;
  s.noKnockback = false;
  s.unbreakable = false;
  s.fearImmune = false;
  s.ignoreDarkness = false;
  s.noFatigue = false;
  s.forceHidden = false;
  s.revealed = false;
  s.markedPct = 0;
  s.glareAcc = 0;
  s.glareMa = 0;
  s.glareSource = 'none';
}

export function tollActive(b: Battle, u: Unit): boolean {
  return b.time < u.tollUntil;
}

export function facingSun(b: Battle, facing: number): boolean {
  return Math.abs(angleDiff(facing, b.terrain.sunBearing)) <= GLARE_ANGLE;
}

function conditionsHold(b: Battle, u: Unit, c: Conditions | undefined, light: LightLevel): boolean {
  if (!c) return true;
  if (c.lightMin !== undefined && light < c.lightMin) return false;
  if (c.lightMax !== undefined && light > c.lightMax) return false;
  if (c.windMin !== undefined && u.wind < c.windMin) return false;
  if (c.windMax !== undefined && u.wind > c.windMax) return false;
  if (c.stationary && u.moving) return false;
  if (c.moving && !u.moving) return false;
  if (c.inCombat && u.engaged === 0) return false;
  if (c.facingSun && !facingSun(b, u.facing)) return false;
  if (c.tollActive && !tollActive(b, u)) return false;
  return true;
}

export function computeStats(b: Battle, u: Unit): void {
  const s = u.stats;
  resetStats(s);
  const lead = u.soldiers.find((x) => x.alive);
  const px = lead && u.def.category === 'colossus' ? lead.x : u.x;
  const py = lead && u.def.category === 'colossus' ? lead.y : u.y;
  u.light = lightAt(b, px, py);
  u.wind = windAt(b, px, py);

  // Zone auras.
  for (const z of b.zones) {
    if (!z.enabled) continue;
    const dx = px - z.x;
    const dy = py - z.y;
    if (dx * dx + dy * dy > z.radius * z.radius) continue;
    const d = z.def;
    if (d.affects && !d.affects.includes(u.def.category)) continue;
    if (z.side === u.side) {
      if (d.allyMods) applyMods(s, d.allyMods);
    } else {
      if (d.enemyMods) applyMods(s, d.enemyMods);
      if (d.drain) s.moraleDrain += d.drain;
      if (d.reveals) s.revealed = true;
    }
  }

  // Timed buffs (expired ones are dropped here).
  for (let i = u.buffs.length - 1; i >= 0; i--) {
    const bf = u.buffs[i]!;
    if (b.time >= bf.until) {
      u.buffs.splice(i, 1);
      continue;
    }
    if (bf.tag === 'allSails') {
      // All Sails: +20% speed while moving downwind (the wind blows sunward).
      if (u.moving && Math.abs(angleDiff(u.facing, b.terrain.sunBearing)) < 1.05) applyMods(s, bf.mods);
      continue;
    }
    applyMods(s, bf.mods);
  }

  // Stances.
  for (const a of u.abilities) {
    if (a.def.kind === 'toggle' && a.on && a.def.stance?.mods) applyMods(s, a.def.stance.mods);
  }

  // Traits and passives, gated by light. Verse of the Unshadowed lifts darkness penalties.
  const light: LightLevel = s.ignoreDarkness ? (Math.max(u.light, 2) as LightLevel) : u.light;
  const fac = factionDef(u.faction);
  for (const p of fac.traits) if (conditionsHold(b, u, p.when, light)) applyMods(s, p.mods);
  for (const p of u.def.passives ?? []) if (conditionsHold(b, u, p.when, light)) applyMods(s, p.mods);

  // Army-wide leadership from the campaign (Bell Range, Dread, crusades, weaknesses).
  const army = b.setup.armies[u.side];
  if (army.leadershipPct) s.leadershipMult += army.leadershipPct / 100;
  // Campaign-wide buffs such as Choir Hymns and unit experience.
  if (army.mods) applyMods(s, army.mods);

  // The Hour, for 6 s after each Toll.
  if (tollActive(b, u) && fac.hours) {
    const hour = fac.hours.find((h) => h.id === b.sides[u.side].hour);
    if (hour) applyMods(s, hour.mods);
  }

  // Blaze: non-Choir units tire faster (LIGHT_RULES[4].fatigueMult).
  if (u.light === 4 && u.faction !== 'choir') s.fatigueRateMult *= LIGHT_RULES[4].fatigueMult;

  // Burning Faith: unbreakable in Bright and Blaze.
  if (hasMechanic(u.def, 'burningFaith') && u.light >= 3) s.unbreakable = true;

  // Colossi never rout.
  if (u.def.category === 'colossus') {
    s.unbreakable = true;
    s.fearImmune = true;
  }

  // Status effects.
  if (u.chill > 0) {
    s.speedMult -= 0.2;
    s.attackSpeedMult -= 0.2;
  }
  if (u.slow > 0) s.speedMult *= 1 - u.slowPct / 100;
  if (u.marked > 0) s.revealed = true;

  // Fatigue.
  if (!s.noFatigue) {
    const f = u.fatigue;
    const pen = f >= FATIGUE.exhausted ? 0.2 : f >= FATIGUE.tired ? 0.1 : f >= FATIGUE.winded ? 0.04 : 0;
    if (pen) {
      s.maMult -= pen;
      s.mdMult -= pen;
      s.speedMult -= pen;
      s.attackSpeedMult -= pen * 0.5;
    }
  }

  // Floors.
  s.speedMult = Math.max(0.15, s.speedMult);
  s.attackSpeedMult = Math.max(0.3, s.attackSpeedMult);
  s.accuracyMult = Math.max(0.1, s.accuracyMult);
  s.leadershipMult = Math.max(0.3, s.leadershipMult);
  s.damageTakenMult = Math.max(0.2, s.damageTakenMult);
  s.maMult = Math.max(0.3, s.maMult);
  s.mdMult = Math.max(0.3, s.mdMult);

  computeGlare(b, u, px, py);
  u.maxMorale = u.def.leadership * s.leadershipMult;
  if (u.morale > u.maxMorale) u.morale = u.maxMorale;
}

/**
 * Glare. A unit facing within 45 degrees of the sun suffers the band's glare;
 * missile units check where they shoot, melee units where they fight.
 * Walking Noon, Mirrorflash and dazzle add artificial glare; the strongest wins.
 */
function computeGlare(b: Battle, u: Unit, px: number, py: number): void {
  const s = u.stats;
  if (hasMechanic(u.def, 'glassblind') || hasMechanic(u.def, 'blind')) return;
  let dir = u.facing;
  if (u.missileTarget && u.engaged === 0 && b.time - u.lastFireTime < 3) {
    dir = datan2(u.missileTarget.y - py, u.missileTarget.x - px);
  }
  let acc = 0;
  let ma = 0;
  let source: UnitStats['glareSource'] = 'none';
  const band = b.terrain.light;
  const bandRule = LIGHT_RULES[band];
  const sunUp = (band === 2 || band === 3) && !darkWinsAt(b, px, py);
  if (sunUp && Math.abs(angleDiff(dir, b.terrain.sunBearing)) <= GLARE_ANGLE) {
    acc = bandRule.glareAccuracyPct;
    ma = bandRule.glareMa;
    source = 'sun';
  }
  // Walking Noon: enemies facing the Nailbearer suffer glare.
  for (const z of b.zones) {
    if (!z.def.glareSource || !z.enabled || z.side === u.side) continue;
    const dx = z.x - px;
    const dy = z.y - py;
    const d2 = dx * dx + dy * dy;
    if (d2 > 160 * 160) continue;
    if (darkWinsAt(b, px, py)) continue;
    if (Math.abs(angleDiff(dir, datan2(dy, dx))) <= GLARE_ANGLE) {
      if (ARTIFICIAL_GLARE.accuracyPct < acc) {
        acc = ARTIFICIAL_GLARE.accuracyPct;
        ma = ARTIFICIAL_GLARE.ma;
        source = 'noon';
      }
    }
  }
  // Mirrorflash: fighting mirror-shield units that face the sun.
  if ((band === 2 || band === 3) && u.engaged > 0 && bandRule.glareAccuracyPct < acc) {
    for (const e of b.units) {
      if (e.side === u.side || e.state !== 'ready' || e.engaged === 0) continue;
      if (!hasMechanic(e.def, 'mirrorflash') || !facingSun(b, e.facing)) continue;
      const dx = e.x - px;
      const dy = e.y - py;
      if (dx * dx + dy * dy > 45 * 45) continue;
      acc = bandRule.glareAccuracyPct;
      ma = Math.min(ma, bandRule.glareMa);
      source = 'mirror';
      break;
    }
  }
  // Lock Mirrors: a dazzle cone ahead of stationary mirror walls in daylight.
  if (acc > -10) {
    for (const e of b.units) {
      if (e.side === u.side || e.state !== 'ready' || e.moving) continue;
      const lm = mechanic(e.def, 'lockMirrors');
      if (!lm || e.light < 2) continue;
      const dx = px - e.x;
      const dy = py - e.y;
      if (dx * dx + dy * dy > lm.dazzleRange * lm.dazzleRange) continue;
      if (Math.abs(angleDiff(e.facing, datan2(dy, dx))) > 0.7) continue;
      acc = -10;
      if (source === 'none') source = 'dazzle';
      break;
    }
  }
  s.glareAcc = acc;
  s.glareMa = ma;
  s.glareSource = source;
}
