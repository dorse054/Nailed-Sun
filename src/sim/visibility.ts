/**
 * Spotting and stealth.
 *
 * Spotting range falls with light at the target (Dim -25%, Dark -50%).
 * Units in shadow stay hidden until an enemy comes within 60 m; stealth units
 * can move through shadow (and The Unlit through Dim and Dark) unrevealed.
 * Units standing in forest are hidden until an enemy is close. Firing and
 * fighting reveal a unit, except Hushbows shooting in the Dark and Queen Ysh's
 * Unlit Step. Sunpatch and Walking Noon reveal stealth; the Listener hears
 * hidden enemies within 100 m.
 */
import { FOREST_REVEAL_RANGE, LIGHT_RULES, SHADOW_REVEAL_RANGE, SPOT_RANGE, STEALTH_REVEAL_RANGE, VISIBILITY_LINGER } from '../data/rules';
import type { Battle } from './battle';
import type { Side, Unit } from './types';
import { hasMechanic, mechanic } from './mechanics';

function concealment(b: Battle, e: Unit): number {
  // Returns the reveal range if the unit is concealed, or 0 if it is in plain sight.
  if (e.def.size === 'colossal') return 0;
  if (e.stats.forceHidden) return 12;
  if (e.stats.revealed) return 0;
  if (hasMechanic(e.def, 'glows')) return 0;
  if (e.engaged > 0) return 0;
  const st = mechanic(e.def, 'stealth');
  if (b.time - e.lastFireTime < 2.5) {
    if (!(st && st.revealOnFire === 'notInDark' && e.light === 0)) return 0;
  }
  const moving = e.moving;
  const forest = b.terrain.inForest(e.x, e.y);
  const shadow = b.terrain.inShadow(e.x, e.y);
  // Queen Ysh: nearby Hush units hide more easily.
  let aura = 1;
  for (const a of b.units) {
    if (a.side !== e.side || a.state !== 'ready') continue;
    const ha = mechanic(a.def, 'hideAura');
    if (!ha) continue;
    if ((a.x - e.x) * (a.x - e.x) + (a.y - e.y) * (a.y - e.y) <= ha.radius * ha.radius) {
      aura = 0.6;
      break;
    }
  }
  if (st) {
    const dark = st.lightMax !== undefined && e.light <= st.lightMax;
    const canMove = st.whileMoving || !moving || aura < 1;
    if (canMove) {
      if (dark) return STEALTH_REVEAL_RANGE * aura;
      if (st.shadow && shadow) return SHADOW_REVEAL_RANGE * aura;
      if (st.forest && forest) return FOREST_REVEAL_RANGE * aura;
    }
  }
  if (e.def.size === 'large' && !forest) return 0;
  if (!moving || aura < 1) {
    if (forest) return FOREST_REVEAL_RANGE * aura;
    if (shadow && e.def.size === 'small') return SHADOW_REVEAL_RANGE * aura;
  }
  return 0;
}

export function updateVisibility(b: Battle): void {
  if (b.tick % 10 !== 0) return;
  const reveal = new Map<Unit, number>();
  for (const u of b.units) {
    if (u.alive <= 0 || u.state === 'dead' || u.state === 'fled') continue;
    const r = concealment(b, u);
    reveal.set(u, r);
    const was = u.concealed;
    u.concealed = r > 0;
    if (u.concealed) {
      u.special.ambushReady = 1;
      if (!was) for (const s of u.soldiers) s.ambush = true;
    } else if (u.special.ambushReady && b.time - (u.special.revealedAt ?? b.time) > 2) {
      u.special.ambushReady = 0;
    }
    if (was && !u.concealed) u.special.revealedAt = b.time;
  }
  for (const side of [0, 1] as Side[]) {
    const observers = b.units.filter((o) => o.side === side && o.alive > 0 && (o.state === 'ready' || o.state === 'routing' || o.state === 'embarked'));
    for (const e of b.units) {
      if (e.side === side) {
        e.visible[side] = true;
        continue;
      }
      if (e.alive <= 0 || e.state === 'dead' || e.state === 'fled') {
        e.visible[side] = false;
        continue;
      }
      if (e.state === 'embarked' && e.embarkedOn) {
        e.visible[side] = e.embarkedOn.visible[side];
        continue;
      }
      const conceal = reveal.get(e) ?? 0;
      const airborne = e.soldiers.some((s) => s.alive && s.airborne);
      let seen = false;
      for (const o of observers) {
        const dx = e.x - o.x;
        const dy = e.y - o.y;
        const d2 = dx * dx + dy * dy;
        let lm = LIGHT_RULES[e.light].spotMult;
        if (hasMechanic(o.def, 'lanternSight')) lm = 1 - (1 - lm) / 2;
        let range = SPOT_RANGE * lm * o.stats.spotMult * (airborne ? 1.3 : 1) * (e.def.size === 'colossal' ? 1.6 : 1);
        if (e.stats.revealed) range *= 1.4;
        if (d2 > range * range) continue;
        if (conceal > 0) {
          const hear = mechanic(o.def, 'hearHidden');
          const r = Math.max(conceal, hear ? hear.radius : 0);
          if (d2 > r * r) continue;
        }
        if (d2 > 70 * 70 && !airborne && e.def.size !== 'colossal') {
          const eo = o.def.category === 'cavalry' ? 3 : o.def.category === 'colossus' ? 20 : 2;
          const ee = e.def.size === 'large' ? 3 : 2;
          if (!b.terrain.los(o.x, o.y, eo, e.x, e.y, ee)) continue;
        }
        seen = true;
        break;
      }
      if (seen) e.lastSeen[side] = b.time;
      e.visible[side] = seen || (conceal === 0 && b.time - e.lastSeen[side] < VISIBILITY_LINGER);
    }
  }
}
