/**
 * Abilities, built from shared effect blocks: damage, zone, buff, knockback,
 * leadership, reveal, repair, ground, toll. A few signature moves need their
 * own motion and timing and run as named scripts.
 *
 * Anti-frustration rule: every big ability has a visible windup (a telegraph
 * on the ground) of at least 2 s before it lands.
 */
import type { AbilityDef, Area, Effect } from '../data/schema';
import { beamMult, SIGNATURE } from '../data/rules';
import { angleDiff, clamp, datan2, dcos, dsin, PI } from '../core/dmath';
import { segDist2 } from '../core/vec';
import type { Battle } from './battle';
import { DT } from './constants';
import type { AbilityState, Soldier, Telegraph, Unit } from './types';
import { applyDamage, applyOnHit, armorRoll, groundFlyer, knockDown, typeMult } from './combat';
import { addZone, beamBlockedAt, ownZone } from './zones';
import { hasMechanic, isFlyer } from './mechanics';
import { moraleState, rout } from './morale';
import { ringToll } from './toll';
import { tollActive } from './stats';
import { layoutSlots } from './army';

export function findAbility(u: Unit, id: string): AbilityState | undefined {
  return u.abilities.find((a) => a.def.id === id);
}

/** Why an ability can't be used right now, or null if it can. */
export function castBlocker(b: Battle, u: Unit, a: AbilityState, x?: number, y?: number, target?: number): string | null {
  if (u.state !== 'ready') return 'Unit is not in control';
  if (a.def.kind === 'toggle') return a.exit > 0 ? 'Changing stance' : a.cooldown > 0 ? 'Recharging' : null;
  if (a.uses <= 0) return 'Already used';
  if (a.cooldown > 0) return 'Recharging';
  if (a.windup > 0 || a.channel > 0) return 'Already casting';
  const def = a.def;
  const origin = casterPos(u);
  if (def.target === 'point' || def.target === 'direction') {
    if (x === undefined || y === undefined) return 'Needs a target point';
    if (def.range && def.target === 'point') {
      const d = Math.sqrt((x - origin.x) * (x - origin.x) + (y - origin.y) * (y - origin.y));
      if (d > def.range) return 'Out of range';
    }
  }
  if (def.target === 'enemy' || def.target === 'ally') {
    const t = target !== undefined ? b.units[target] : undefined;
    if (!t || t.alive <= 0 || t.state === 'dead' || t.state === 'fled') return 'Needs a target unit';
    if (def.target === 'enemy' && t.side === u.side) return 'Needs an enemy';
    if (def.target === 'ally' && t.side !== u.side) return 'Needs an ally';
    if (def.target === 'enemy' && !t.visible[u.side]) return 'Target not visible';
    if (def.range) {
      const d = Math.sqrt((t.x - origin.x) * (t.x - origin.x) + (t.y - origin.y) * (t.y - origin.y));
      if (d > def.range) return 'Out of range';
    }
    const rep = def.effects.find((e) => e.kind === 'repair');
    if (rep && rep.kind === 'repair' && !rep.targets.includes(t.def.id)) return 'Cannot repair that unit';
  }
  if (def.effects.some((e) => e.kind === 'script' && e.name === 'rammingRun')) {
    if (!u.moving) return 'Must be under sail';
  }
  if (def.effects.some((e) => e.kind === 'script' && e.name === 'harpoonHook')) {
    const t = target !== undefined ? b.units[target] : undefined;
    if (!t || !t.def.character) return 'Needs an enemy hero or lord';
  }
  if (def.effects.some((e) => e.kind === 'script' && e.name === 'stoop')) {
    const t = target !== undefined ? b.units[target] : undefined;
    if (!t || (!t.def.character && t.def.role !== 'artillery')) return 'Needs a hero, lord or artillery';
  }
  return null;
}

export function casterPos(u: Unit): { x: number; y: number } {
  if (u.soldiers.length <= 4) {
    const s = u.soldiers.find((x) => x.alive);
    if (s) return { x: s.x, y: s.y };
  }
  const lead = u.soldiers.find((x) => x.alive && x.leader);
  if (lead) return { x: lead.x, y: lead.y };
  return { x: u.x, y: u.y };
}

export function castAbility(b: Battle, u: Unit, id: string, x?: number, y?: number, target?: number): boolean {
  const a = findAbility(u, id);
  if (!a) return false;
  if (castBlocker(b, u, a, x, y, target) !== null) return false;
  const def = a.def;
  if (def.kind === 'toggle') {
    toggle(b, u, a);
    return true;
  }
  const origin = casterPos(u);
  if (def.target === 'enemy' || def.target === 'ally') {
    const t = b.units[target!]!;
    a.targetUnit = t.id;
    a.tx = t.x;
    a.ty = t.y;
  } else if (def.target === 'point' || def.target === 'direction') {
    a.tx = x!;
    a.ty = y!;
    a.targetUnit = -1;
  } else {
    a.tx = origin.x + dcos(u.facing) * 30;
    a.ty = origin.y + dsin(u.facing) * 30;
    a.targetUnit = -1;
  }
  if (def.uses !== undefined) a.uses--;
  a.cooldown = def.cooldown;
  b.events.push({ t: 'ability', unit: u.id, name: def.name, x: origin.x, y: origin.y, side: u.side });
  if (def.windup && def.windup > 0) {
    a.windup = def.windup;
    b.telegraphs.push(telegraphFor(b, u, a));
    return true;
  }
  execute(b, u, a);
  return true;
}

function toggle(b: Battle, u: Unit, a: AbilityState): void {
  const st = a.def.stance ?? {};
  a.on = !a.on;
  a.cooldown = 1.5;
  if (!a.on && st.exitTime) a.exit = st.exitTime;
  if (st.formation) {
    u.formation = a.on ? 'ring' : 'block';
    u.slotsDirty = true;
    layoutSlots(u);
  }
  if (st.lightOff) {
    const z = ownZone(b, u);
    if (z) z.enabled = !a.on;
  }
  if (st.altMissile) {
    u.altAmmo = a.on;
    for (const s of u.soldiers) s.reload = Math.max(s.reload, 2);
  }
  if (a.on && st.immobile) {
    u.order = { kind: 'hold' };
    u.path = [];
    if (hasMechanic(u.def, 'sailing')) u.special.anchored = 1;
  }
  if (!a.on && hasMechanic(u.def, 'sailing')) u.special.anchored = 0;
  b.events.push({ t: 'ability', unit: u.id, name: `${a.def.name}${a.on ? '' : ' (off)'}`, x: u.x, y: u.y, side: u.side });
}

function telegraphFor(b: Battle, u: Unit, a: AbilityState): Telegraph {
  const def = a.def;
  const origin = casterPos(u);
  const dir = datan2(a.ty - origin.y, a.tx - origin.x);
  const t: Telegraph = {
    id: b.nextTelegraphId++,
    unit: u.id,
    side: u.side,
    name: def.name,
    shape: 'circle',
    x: origin.x,
    y: origin.y,
    radius: 30,
    dir,
    angle: 0,
    width: 0,
    start: b.time,
    end: b.time + (def.windup ?? 0),
  };
  const area = mainArea(def);
  const script = def.effects.find((e) => e.kind === 'script');
  if (script && script.kind === 'script') {
    switch (script.name) {
      case 'noonLance':
        t.shape = 'arc';
        t.radius = 300;
        t.angle = PI / 2;
        t.dir = u.facing;
        return t;
      case 'hourThatNeverComes':
        t.shape = 'ring';
        t.radius = 120;
        return t;
      case 'dive':
        t.shape = 'line';
        t.radius = 60;
        t.width = 16;
        return t;
      case 'thousandEyes':
        t.shape = 'cone';
        t.radius = 220;
        t.angle = (120 * PI) / 180;
        return t;
    }
  }
  if (area) {
    if (area.shape === 'circle') {
      t.shape = 'circle';
      t.radius = area.radius;
      if (area.at === 'target') {
        t.x = a.tx;
        t.y = a.ty;
      }
    } else if (area.shape === 'cone') {
      t.shape = 'cone';
      t.radius = area.radius;
      t.angle = (area.angle * PI) / 180;
    } else if (area.shape === 'line') {
      t.shape = 'line';
      t.radius = area.length;
      t.width = area.width;
    }
  }
  return t;
}

function mainArea(def: AbilityDef): Area | undefined {
  for (const e of def.effects) if ('area' in e && e.area) return e.area;
  return undefined;
}

export function updateAbilities(b: Battle): void {
  for (const u of b.units) {
    if (u.alive <= 0) continue;
    for (const a of u.abilities) {
      if (a.cooldown > 0) a.cooldown = Math.max(0, a.cooldown - DT);
      if (a.exit > 0) a.exit = Math.max(0, a.exit - DT);
      if (u.state !== 'ready') {
        a.windup = 0;
        if (a.channel > 0) endChannel(b, u, a);
        continue;
      }
      if (a.windup > 0) {
        a.windup -= DT;
        u.special.channelStill = 1;
        if (a.windup <= 0) {
          a.windup = 0;
          u.special.channelStill = 0;
          execute(b, u, a);
        }
      } else if (a.channel > 0) {
        a.channel -= DT;
        a.t += DT;
        channelTick(b, u, a);
        if (a.channel <= 0) endChannel(b, u, a);
      }
    }
    // Unveil darkens the Nailbearer's light for 20 s.
    if (u.special.noonOffUntil && b.time >= u.special.noonOffUntil) {
      u.special.noonOffUntil = 0;
      const z = ownZone(b, u);
      if (z) z.enabled = true;
    }
    if (u.special.ramUntil && b.time >= u.special.ramUntil) {
      u.special.ramUntil = 0;
      u.special.slowUntil = b.time + 8;
      u.buffs.push({ mods: { speedPct: -50 }, until: b.time + 8, tag: 'turning' });
    }
  }
  // Drop finished telegraphs.
  for (let i = b.telegraphs.length - 1; i >= 0; i--) {
    if (b.time > b.telegraphs[i]!.end + 0.4) b.telegraphs.splice(i, 1);
  }
}

function execute(b: Battle, u: Unit, a: AbilityState): void {
  // Track a moving target.
  if (a.targetUnit >= 0) {
    const t = b.units[a.targetUnit];
    if (t && t.alive > 0) {
      a.tx = t.x;
      a.ty = t.y;
    }
  }
  for (const e of a.def.effects) applyEffect(b, u, a, e);
  if (a.def.channel) {
    a.channel = a.def.channel;
    a.t = 0;
    a.hitSet = new Set();
    startChannel(b, u, a);
  }
}

function areaTest(u: Unit, a: AbilityState, area: Area): (x: number, y: number, r: number) => boolean {
  const o = casterPos(u);
  const dir = datan2(a.ty - o.y, a.tx - o.x);
  switch (area.shape) {
    case 'field':
      return () => true;
    case 'circle': {
      const cx = area.at === 'target' ? a.tx : o.x;
      const cy = area.at === 'target' ? a.ty : o.y;
      return (x, y, r) => (x - cx) * (x - cx) + (y - cy) * (y - cy) <= (area.radius + r) * (area.radius + r);
    }
    case 'cone': {
      const half = (area.angle * PI) / 360;
      return (x, y, r) => {
        const dx = x - o.x;
        const dy = y - o.y;
        const d2 = dx * dx + dy * dy;
        if (d2 > (area.radius + r) * (area.radius + r)) return false;
        if (d2 < 4) return true;
        return Math.abs(angleDiff(dir, datan2(dy, dx))) <= half;
      };
    }
    case 'line': {
      const ex = o.x + dcos(dir) * area.length;
      const ey = o.y + dsin(dir) * area.length;
      return (x, y, r) => segDist2(x, y, o.x, o.y, ex, ey) <= (area.width / 2 + r) * (area.width / 2 + r);
    }
  }
}

function whoMatches(u: Unit, other: Unit, who: string, targetId: number): boolean {
  switch (who) {
    case 'self':
      return other === u;
    case 'allies':
      return other.side === u.side;
    case 'enemies':
      return other.side !== u.side;
    case 'all':
      return true;
    case 'target':
      return other.id === targetId;
  }
  return false;
}

function applyEffect(b: Battle, u: Unit, a: AbilityState, e: Effect): void {
  switch (e.kind) {
    case 'damage': {
      const test = areaTest(u, a, e.area);
      const src = u.soldiers.find((x) => x.alive) ?? null;
      for (const t of b.units) {
        if (t.alive <= 0 || t.state === 'dead' || t.state === 'fled' || t.state === 'embarked') continue;
        if (!whoMatches(u, t, e.who, a.targetUnit)) continue;
        for (const s of t.soldiers) {
          if (!s.alive || !test(s.x, s.y, s.radius)) continue;
          if (e.share !== undefined && b.rng.next() > e.share) continue;
          const dmg = armorRoll(b.rng, e.damage, e.ap, s.armor + t.stats.armorAdd) * u.stats.dmgMult * typeMult(e.type, t);
          applyDamage(b, s, dmg, src, e.type, u);
          applyOnHit(b, e.onHit, s, u, s.x, s.y);
        }
      }
      break;
    }
    case 'knockback': {
      const test = areaTest(u, a, e.area);
      const o = casterPos(u);
      for (const t of b.units) {
        if (t.alive <= 0 || t.state === 'dead' || t.state === 'fled' || t.state === 'embarked' || t === u) continue;
        if (!whoMatches(u, t, e.who, a.targetUnit)) continue;
        if (e.exceptHour && t.side === u.side && tollActive(b, t) && b.sides[t.side].hour === e.exceptHour) continue;
        for (const s of t.soldiers) {
          if (!s.alive || !test(s.x, s.y, s.radius)) continue;
          const ang = datan2(s.y - o.y, s.x - o.x);
          knockDown(b, s, dcos(ang), dsin(ang), e.force, e.knockdown);
        }
      }
      break;
    }
    case 'zone': {
      const o = casterPos(u);
      const x = e.at === 'target' ? a.tx : o.x;
      const y = e.at === 'target' ? a.ty : o.y;
      addZone(b, e.zone, u.side, x, y, e.duration, u, e.at === 'attached');
      break;
    }
    case 'buff': {
      const test = e.area ? areaTest(u, a, e.area) : null;
      for (const t of b.units) {
        if (t.alive <= 0 || t.state === 'dead' || t.state === 'fled') continue;
        if (!whoMatches(u, t, e.who, a.targetUnit)) continue;
        if (test && !test(t.x, t.y, 6)) continue;
        if (e.mods.leadershipPct && e.mods.leadershipPct < 0 && t.stats.fearImmune) continue;
        t.buffs.push({ mods: e.mods, until: b.time + e.duration, tag: e.tag, source: u.id });
        if (e.mods.leadershipPct && e.mods.leadershipPct < 0) t.morale += (e.mods.leadershipPct / 100) * t.maxMorale * 0.5;
      }
      break;
    }
    case 'leadership': {
      const test = areaTest(u, a, e.area);
      for (const t of b.units) {
        if (t.state !== 'ready' || !whoMatches(u, t, e.who, a.targetUnit)) continue;
        if (!test(t.x, t.y, 8)) continue;
        if (e.pct < 0 && t.stats.fearImmune) continue;
        const wavering = moraleState(t) === 'wavering';
        t.morale += (e.pct / 100) * t.maxMorale;
        if (e.breakWavering && wavering && !t.stats.unbreakable) rout(b, t);
      }
      break;
    }
    case 'reveal': {
      const test = areaTest(u, a, e.area);
      for (const t of b.units) {
        if (t.side === u.side || t.alive <= 0) continue;
        if (!test(t.x, t.y, 10)) continue;
        t.buffs.push({ mods: { revealed: true }, until: b.time + e.duration, tag: 'revealed' });
      }
      break;
    }
    case 'repair': {
      const t = b.units[a.targetUnit];
      if (!t || !e.targets.includes(t.def.id)) break;
      for (const s of t.soldiers) {
        if (!s.alive) continue;
        s.hp = Math.min(s.maxHp, s.hp + s.maxHp * (e.pct / 100));
      }
      if (t.special.elkHp !== undefined && t.special.elkMax) t.special.elkHp = Math.min(t.special.elkMax, t.special.elkHp + t.special.elkMax * (e.pct / 100));
      b.events.push({ t: 'text', x: t.x, y: t.y, text: 'Repaired', side: t.side });
      break;
    }
    case 'ground': {
      const test = areaTest(u, a, e.area);
      for (const t of b.units) {
        if (!whoMatches(u, t, e.who, a.targetUnit) || !isFlyer(t.def)) continue;
        if (test(t.x, t.y, 10)) groundFlyer(b, t, e.duration);
      }
      break;
    }
    case 'summon':
      // Reserved for future content: v1 abilities do not summon.
      break;
    case 'toll':
      ringToll(b, u.side, true);
      break;
    case 'script':
      startScript(b, u, a, e.name);
      break;
  }
}

function startScript(b: Battle, u: Unit, a: AbilityState, name: string): void {
  const o = casterPos(u);
  switch (name) {
    case 'unveil': {
      // A flash that blinds every enemy within 150 m for 8 s; then the light goes dark for 20 s.
      b.events.push({ t: 'shockwave', x: o.x, y: o.y, r: 150, kind: 'flash' });
      for (const t of b.units) {
        if (t.side === u.side || t.alive <= 0 || t.state === 'dead') continue;
        const d2 = (t.x - o.x) * (t.x - o.x) + (t.y - o.y) * (t.y - o.y);
        if (d2 > 150 * 150) continue;
        if (hasMechanic(t.def, 'blind')) continue;
        t.buffs.push({ mods: { accuracyPct: -30, ma: -10 }, until: b.time + 8, tag: 'blinded' });
      }
      const z = ownZone(b, u);
      if (z) z.enabled = false;
      u.special.noonOffUntil = b.time + 20;
      break;
    }
    case 'thousandEyes': {
      // Units in a 120 degree cone lose 25% leadership at once; wavering units break.
      b.events.push({ t: 'shockwave', x: o.x, y: o.y, r: 220, kind: 'eyes' });
      const dir = datan2(a.ty - o.y, a.tx - o.x);
      for (const t of b.units) {
        if (t.side === u.side || t.state !== 'ready') continue;
        const dx = t.x - o.x;
        const dy = t.y - o.y;
        if (dx * dx + dy * dy > 220 * 220) continue;
        if (Math.abs(angleDiff(dir, datan2(dy, dx))) > PI / 3) continue;
        if (t.stats.fearImmune) continue;
        const wavering = moraleState(t) === 'wavering';
        t.morale -= 0.25 * t.maxMorale;
        if (wavering && !t.stats.unbreakable) rout(b, t);
        else if (t.morale <= 0 && !t.stats.unbreakable) rout(b, t);
      }
      break;
    }
    case 'rammingRun':
      u.special.ramUntil = b.time + 6;
      u.running = true;
      b.events.push({ t: 'text', x: o.x, y: o.y, text: 'Ramming run!', side: u.side });
      break;
    case 'harpoonHook': {
      const t = b.units[a.targetUnit];
      if (!t) break;
      const victim = t.soldiers.find((s) => s.alive && s.leader) ?? t.soldiers.find((s) => s.alive);
      if (!victim) break;
      const ang = datan2(o.y - victim.y, o.x - victim.x);
      const d = Math.sqrt((o.x - victim.x) * (o.x - victim.x) + (o.y - victim.y) * (o.y - victim.y));
      const pull = Math.min(15, Math.max(0, d - 3));
      victim.x += dcos(ang) * pull;
      victim.y += dsin(ang) * pull;
      victim.px = victim.x;
      victim.py = victim.y;
      knockDown(b, victim, 0, 0, 0, 1.5);
      applyDamage(b, victim, 40, null, 'normal', u);
      b.events.push({ t: 'beam', kind: 'lance', x1: o.x, y1: o.y, x2: victim.x, y2: victim.y, power: 0.05, blocked: false, side: u.side });
      b.events.push({ t: 'text', x: victim.x, y: victim.y, text: 'Hooked out!', side: u.side });
      break;
    }
    case 'gustLeap': {
      // Glide 30 m downwind over the front rank to strike the one behind.
      const dir = b.terrain.sunBearing;
      u.special.leapUntil = b.time + 1.3;
      u.special.leapDx = dcos(dir) * 30;
      u.special.leapDy = dsin(dir) * 30;
      u.chargeValue = u.def.charge + u.stats.chargeBonus + 10;
      u.chargeStart = b.time;
      for (const s of u.soldiers) {
        if (!s.alive) continue;
        s.airborne = true;
        s.target = null;
        s.charging = true;
      }
      u.x += u.special.leapDx;
      u.y += u.special.leapDy;
      u.x = clamp(u.x, 5, b.terrain.width - 5);
      u.y = clamp(u.y, 5, b.terrain.height - 5);
      u.order = { kind: 'hold' };
      break;
    }
    case 'stoop': {
      const t = b.units[a.targetUnit];
      if (!t) break;
      const victim = t.soldiers.find((s) => s.alive && s.leader) ?? t.soldiers.find((s) => s.alive);
      const me = u.soldiers.find((s) => s.alive);
      if (!victim || !me) break;
      me.x = victim.x - dcos(u.facing) * 2;
      me.y = victim.y - dsin(u.facing) * 2;
      me.px = me.x;
      me.py = me.y;
      u.x = me.x;
      u.y = me.y;
      applyDamage(b, victim, 160, me, 'normal', u);
      if (victim.alive) knockDown(b, victim, dcos(u.facing), dsin(u.facing), 2, 1.8);
      b.events.push({ t: 'charge', x: victim.x, y: victim.y, unit: u.id, power: 80 });
      u.order = { kind: 'attack', target: t.id, run: true };
      break;
    }
    case 'allSails':
      for (const t of b.units) {
        if (t.side !== u.side || t.alive <= 0) continue;
        t.buffs.push({ mods: { speedPct: 20 }, until: b.time + 20, tag: 'allSails' });
      }
      break;
    case 'signal':
      // Heliograph Signal is a zone; nothing extra to do.
      break;
    case 'noonLance':
    case 'hourThatNeverComes':
    case 'dive':
      // Channelled; handled per tick.
      break;
  }
}

function startChannel(b: Battle, u: Unit, a: AbilityState): void {
  const script = scriptOf(a.def);
  if (script === 'noonLance') {
    u.special.coreExposed = 1;
    u.special.channelStill = 1;
    a.tx = u.facing;
  } else if (script === 'hourThatNeverComes') {
    u.special.channelStill = 1;
    const o = casterPos(u);
    b.events.push({ t: 'toll', side: u.side, x: o.x, y: o.y, hour: b.sides[u.side].hour, big: true });
    b.events.push({ t: 'shockwave', x: o.x, y: o.y, r: 120, kind: 'bell' });
    // Every enemy on the field loses 15% leadership.
    for (const t of b.units) {
      if (t.side === u.side || t.state !== 'ready' || t.stats.fearImmune) continue;
      t.morale -= 0.15 * t.maxMorale;
    }
  } else if (script === 'dive') {
    const o = casterPos(u);
    const dir = datan2(a.ty - o.y, a.tx - o.x);
    u.special.diveDir = dir;
    u.special.diveX = o.x;
    u.special.diveY = o.y;
    u.facing = dir;
    for (const s of u.soldiers) s.airborne = true;
  }
}

function scriptOf(def: AbilityDef): string | undefined {
  for (const e of def.effects) if (e.kind === 'script') return e.name;
  return undefined;
}

function channelTick(b: Battle, u: Unit, a: AbilityState): void {
  const script = scriptOf(a.def);
  const o = casterPos(u);
  const total = a.def.channel ?? 1;
  const f = clamp(a.t / total, 0, 1);
  if (script === 'noonLance') {
    // Sweep a beam across a 90 degree arc out to 300 m.
    const base = a.tx;
    const ang = base - PI / 4 + (PI / 2) * f;
    let ex = o.x + dcos(ang) * SIGNATURE.noonLance.range;
    let ey = o.y + dsin(ang) * SIGNATURE.noonLance.range;
    const bt = beamBlockedAt(b, o.x, o.y, ex, ey);
    if (bt >= 0) {
      ex = o.x + (ex - o.x) * bt;
      ey = o.y + (ey - o.y) * bt;
    }
    const power = beamMult(u.light);
    if (b.tick % 2 === 0) b.events.push({ t: 'beam', kind: 'lance', x1: o.x, y1: o.y, x2: ex, y2: ey, power, blocked: bt >= 0, side: u.side });
    // The beam burns through the first few bodies in its path; those behind them are shielded.
    const hitSet = a.hitSet!;
    const inBeam: { s: Soldier; d2: number }[] = [];
    for (const t of b.units) {
      if (t.side === u.side || t.alive <= 0 || t.state === 'dead' || t.state === 'fled' || t.state === 'embarked') continue;
      for (const s of t.soldiers) {
        if (!s.alive) continue;
        const lim = SIGNATURE.noonLance.halfWidth + s.radius;
        if (segDist2(s.x, s.y, o.x, o.y, ex, ey) > lim * lim) continue;
        inBeam.push({ s, d2: (s.x - o.x) * (s.x - o.x) + (s.y - o.y) * (s.y - o.y) });
      }
    }
    inBeam.sort((p, q) => p.d2 - q.d2 || p.s.id - q.s.id);
    const n = Math.min(inBeam.length, SIGNATURE.noonLance.pierce);
    for (let k = 0; k < n; k++) {
      const s = inBeam[k]!.s;
      if (hitSet.has(s.id)) continue;
      hitSet.add(s.id);
      const t = s.unit;
      const dmg = armorRoll(b.rng, SIGNATURE.noonLance.damage, SIGNATURE.noonLance.ap, s.armor + t.stats.armorAdd) * power * u.stats.dmgMult * typeMult('fire', t);
      applyDamage(b, s, dmg, null, 'fire', u);
    }
  } else if (script === 'hourThatNeverComes') {
    // A ring expands to 120 m and knocks down every unit, friend and foe.
    const r0 = 120 * clamp((a.t - DT) / total, 0, 1);
    const r1 = 120 * f;
    for (const t of b.units) {
      if (t === u || t.alive <= 0 || t.state === 'dead' || t.state === 'fled' || t.state === 'embarked') continue;
      const ironFriend = t.side === u.side && tollActive(b, t) && b.sides[t.side].hour === 'iron';
      let grounded = false;
      for (const s of t.soldiers) {
        if (!s.alive) continue;
        const d = Math.sqrt((s.x - o.x) * (s.x - o.x) + (s.y - o.y) * (s.y - o.y));
        if (d < r0 || d > r1 + s.radius) continue;
        if (hasMechanic(t.def, 'brittle')) {
          applyDamage(b, s, armorRoll(b.rng, SIGNATURE.hourThatNeverComes.damage, SIGNATURE.hourThatNeverComes.ap, s.armor) * 1.5, null, 'resonance', u);
        }
        if (s.airborne) grounded = true;
        if (!ironFriend && s.alive) {
          const ang = datan2(s.y - o.y, s.x - o.x);
          knockDown(b, s, dcos(ang), dsin(ang), 2.5, 2.2);
        }
      }
      if (grounded) groundFlyer(b, t, 6);
    }
  } else if (script === 'dive') {
    // Swoop along a 60 m line, knocking infantry flat, then climb away.
    const dir = u.special.diveDir ?? u.facing;
    const d = 80 * f;
    const x = (u.special.diveX ?? o.x) + dcos(dir) * d;
    const y = (u.special.diveY ?? o.y) + dsin(dir) * d;
    const me = u.soldiers.find((s) => s.alive);
    if (me) {
      me.x = clamp(x, 2, b.terrain.width - 2);
      me.y = clamp(y, 2, b.terrain.height - 2);
      u.x = me.x;
      u.y = me.y;
    }
    if (d <= 62) {
      const hitSet = a.hitSet!;
      for (const t of b.units) {
        if (t.side === u.side || t.alive <= 0 || t.state === 'dead' || t.state === 'embarked') continue;
        for (const s of t.soldiers) {
          if (!s.alive || hitSet.has(s.id)) continue;
          const dd = (s.x - x) * (s.x - x) + (s.y - y) * (s.y - y);
          if (dd > 10 * 10) continue;
          hitSet.add(s.id);
          applyDamage(b, s, armorRoll(b.rng, SIGNATURE.dive.damage, SIGNATURE.dive.ap, s.armor), null, 'normal', u);
          if (t.def.category === 'infantry' || t.def.size === 'small') {
            const ang = datan2(s.y - y, s.x - x);
            knockDown(b, s, dcos(ang), dsin(ang), 2, 1.8);
          }
        }
      }
    }
  }
}

function endChannel(_b: Battle, u: Unit, a: AbilityState): void {
  a.channel = 0;
  a.hitSet = null;
  const script = scriptOf(a.def);
  if (script === 'noonLance') u.special.coreExposed = 0;
  if (script === 'dive') {
    u.order = { kind: 'hold' };
    for (const s of u.soldiers) s.airborne = u.grounded <= 0;
  }
  u.special.channelStill = 0;
}
