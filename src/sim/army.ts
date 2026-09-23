/**
 * Building units from data, formation slots and automatic deployment.
 */
import type { Category, UnitDef } from '../data/schema';
import { dcos, dsin, HALF_PI, PI, TAU } from '../core/dmath';
import type { AbilityState, Side, Soldier, Unit, UnitSpec } from './types';
import { emptyStats } from './types';
import type { Terrain } from './terrain';

export interface FormationSpec {
  spacing: number;
  depth: number;
  ranks: number;
  radius: number;
}

export function formationSpec(def: UnitDef): FormationSpec {
  const cat = def.category;
  const loose = def.mechanics?.some((m) => m.kind === 'scatter') ?? false;
  const radius = def.radius ?? defaultRadius(def);
  let spacing = def.spacing ?? defaultSpacing(cat, radius);
  if (loose) spacing *= 1.9;
  const depthMult = cat === 'cavalry' || cat === 'beast' ? 1.35 : cat === 'artillery' ? 1 : 1.12;
  let ranks = def.ranks ?? defaultRanks(def);
  if (def.soldiers <= 1) ranks = 1;
  return { spacing, depth: spacing * depthMult, ranks, radius };
}

function defaultRadius(def: UnitDef): number {
  switch (def.category) {
    case 'infantry':
      return 0.45;
    case 'cavalry':
      return 1.15;
    case 'beast':
      return 0.8;
    case 'monster':
      return 2.6;
    case 'artillery':
      return 2.2;
    case 'flyer':
      return 1.6;
    case 'colossus':
      return 9;
    case 'character':
      return def.size === 'small' ? 0.6 : 1.2;
  }
}

function defaultSpacing(cat: Category, radius: number): number {
  switch (cat) {
    case 'infantry':
      return 1.25;
    case 'cavalry':
      return 2.7;
    case 'beast':
      return 1.9;
    case 'monster':
      return radius * 2 + 3;
    case 'artillery':
      return 13;
    case 'flyer':
      return 4.2;
    case 'colossus':
      return 1;
    case 'character':
      return radius * 2 + 0.9;
  }
}

function defaultRanks(def: UnitDef): number {
  const n = def.soldiers;
  switch (def.category) {
    case 'infantry':
      return n >= 90 ? 5 : n >= 50 ? 4 : 3;
    case 'cavalry':
      return 2;
    case 'beast':
      return 3;
    case 'monster':
      return n >= 5 ? 2 : 1;
    case 'artillery':
      return 1;
    case 'flyer':
      return 2;
    case 'colossus':
      return 1;
    case 'character':
      return n > 1 ? 2 : 1;
  }
}

export function defaultFiles(def: UnitDef, count: number): number {
  const f = formationSpec(def);
  return Math.max(1, Math.ceil(count / f.ranks));
}

/**
 * Recompute formation slot offsets for the living soldiers.
 * Offsets are (right, back) in the unit's frame, centered on the anchor.
 */
export function layoutSlots(u: Unit): void {
  const living = u.soldiers.filter((s) => s.alive);
  const n = living.length;
  const spec = formationSpec(u.def);
  const slots = new Float64Array(Math.max(1, n) * 3);
  if (u.formation === 'ring' && n > 1) {
    // Concentric rings facing outward (Set the Dial, Form Square).
    const perRing = Math.max(8, Math.floor((TAU * Math.max(4, (n * spec.spacing) / TAU / 2)) / spec.spacing));
    let placed = 0;
    let ring = 0;
    while (placed < n) {
      const count = Math.min(n - placed, Math.max(6, perRing - ring * 6));
      const r = Math.max(2, (count * spec.spacing) / TAU);
      for (let k = 0; k < count; k++) {
        const a = (k / count) * TAU;
        const i = placed + k;
        slots[i * 3] = dcos(a) * r;
        slots[i * 3 + 1] = dsin(a) * r;
        slots[i * 3 + 2] = a;
      }
      placed += count;
      ring++;
    }
  } else {
    const files = Math.max(1, Math.min(u.files, n));
    const ranks = Math.ceil(n / files);
    for (let i = 0; i < n; i++) {
      const rank = Math.floor(i / files);
      let file = i % files;
      const inRank = rank === ranks - 1 ? n - rank * files : files;
      // Center a short last rank.
      const offset = (files - inRank) / 2;
      if (rank === ranks - 1) file += offset;
      slots[i * 3] = (file - (files - 1) / 2) * spec.spacing;
      slots[i * 3 + 1] = (rank - (ranks - 1) / 2) * spec.depth;
      slots[i * 3 + 2] = Number.NaN;
    }
    // The character stands at the heart of the bodyguard.
    const leaderIdx = living.findIndex((s) => s.leader);
    if (leaderIdx > 0) {
      let best = 0;
      let bestD = Infinity;
      for (let i = 0; i < n; i++) {
        const d = slots[i * 3]! * slots[i * 3]! + slots[i * 3 + 1]! * slots[i * 3 + 1]!;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      const tmp = living[best]!;
      living[best] = living[leaderIdx]!;
      living[leaderIdx] = tmp;
    }
  }
  for (let i = 0; i < n; i++) living[i]!.slot = i;
  u.slots = slots;
  u.slotsDirty = false;
}

/** World position of a slot for the unit's current anchor and facing. */
export function slotPos(u: Unit, slot: number, out: { x: number; y: number }): void {
  const lx = u.slots[slot * 3] ?? 0;
  const ly = u.slots[slot * 3 + 1] ?? 0;
  const fx = dcos(u.facing);
  const fy = dsin(u.facing);
  // right = (-fy, fx) on a y-down screen; back = -forward.
  out.x = u.x + -fy * lx - fx * ly;
  out.y = u.y + fx * lx - fy * ly;
}

/** Facing of a ring slot (outward), or the unit facing for blocks. */
export function slotFacing(u: Unit, slot: number): number {
  const a = u.slots[slot * 3 + 2];
  if (a === undefined || Number.isNaN(a)) return u.facing;
  // Local (right, back) direction a maps to world angle facing + 90deg + a.
  return u.facing + HALF_PI + a;
}

/** Width and depth of the current formation, in meters. */
export function formationSize(u: Unit): { width: number; depth: number } {
  const spec = formationSpec(u.def);
  if (u.formation === 'ring') {
    const r = Math.max(2, (u.alive * spec.spacing) / TAU);
    return { width: r * 2, depth: r * 2 };
  }
  const files = Math.max(1, Math.min(u.files, u.alive));
  const ranks = Math.ceil(u.alive / files);
  return { width: files * spec.spacing, depth: ranks * spec.depth };
}

/** Builds a unit; the battle assigns soldier ids when it adds the unit. */
export function createUnit(id: number, def: UnitDef, side: Side, spec: UnitSpec, scale: number): Unit {
  const fspec = formationSpec(def);
  const scalable = def.soldiers >= 12 && (def.category === 'infantry' || def.category === 'cavalry' || def.category === 'beast' || def.category === 'flyer' || def.category === 'character');
  let count = scalable ? Math.max(4, Math.round(def.soldiers * scale)) : def.soldiers;
  if (spec.strength !== undefined) count = Math.max(1, Math.round(count * spec.strength));
  const rankBonus = (spec.rank ?? 0) * 3;
  const u: Unit = {
    id,
    def,
    side,
    faction: def.faction,
    soldiers: [],
    alive: count,
    initial: count,
    x: spec.x ?? 0,
    y: spec.y ?? 0,
    facing: spec.facing ?? (side === 0 ? -HALF_PI : HALF_PI),
    files: spec.files ?? Math.max(1, Math.ceil(count / fspec.ranks)),
    formation: 'block',
    order: { kind: 'hold' },
    path: [],
    moving: false,
    running: true,
    withdrawing: false,
    meleeTarget: null,
    missileTarget: null,
    fireAtWill: true,
    engaged: 0,
    lastMeleeTime: -999,
    lastLossTime: -999,
    lastFireTime: -999,
    focus: 0,
    focusTarget: -1,
    morale: def.leadership,
    maxMorale: def.leadership,
    state: 'ready',
    routs: 0,
    rallyTimer: 0,
    losses: [0, 0, 0, 0, 0, 0, 0, 0],
    meleeDealt: 0,
    meleeTaken: 0,
    fatigue: 0,
    buffs: [],
    stats: emptyStats(),
    light: 2,
    wind: 1,
    visible: [side === 0, side === 1],
    lastSeen: [-999, -999],
    concealed: false,
    chill: 0,
    slow: 0,
    slowPct: 0,
    grounded: 0,
    marked: 0,
    stunLock: 0,
    tollUntil: -999,
    abilities: (def.abilities ?? []).map(
      (a): AbilityState => ({
        def: a,
        cooldown: 0,
        uses: a.uses ?? Infinity,
        on: false,
        windup: 0,
        channel: 0,
        exit: 0,
        tx: 0,
        ty: 0,
        targetUnit: -1,
        t: 0,
        hitSet: null,
      }),
    ),
    special: {},
    kills: 0,
    damageDealt: 0,
    valueDealt: 0,
    damageTaken: 0,
    isGeneral: def.character?.kind === 'lord',
    embarkedOn: null,
    passengers: [],
    chargeValue: 0,
    chargeStart: -999,
    slots: new Float64Array(3),
    slotsDirty: true,
    tag: spec.tag ?? '',
    cost: def.cost,
    hpStart: 0,
    altAmmo: false,
    entityScale: scalable ? 1 : Math.min(1, scale),
  };
  const flyer = def.mechanics?.some((m) => m.kind === 'flyer') ?? false;
  for (let i = 0; i < count; i++) {
    const leader = i === 0 && !!def.leader;
    const L = def.leader;
    const hp = (leader && L ? L.hp : def.hp) * u.entityScale;
    const s: Soldier = {
      id: -1,
      unit: u,
      slot: i,
      x: u.x,
      y: u.y,
      px: u.x,
      py: u.y,
      vx: 0,
      vy: 0,
      facing: u.facing,
      hp,
      maxHp: hp,
      alive: true,
      leader,
      radius: leader && L ? (L.size === 'small' ? 0.6 : 1.2) : fspec.radius,
      mass: leader && L ? L.mass : def.mass,
      armor: leader && L ? L.armor : def.armor,
      ma: (leader && L ? L.ma : def.ma) + rankBonus,
      md: (leader && L ? L.md : def.md) + rankBonus,
      target: null,
      approach: null,
      atkTimer: 0.5 + ((i * 7) % 10) / 10,
      chargeTimer: 0,
      cb: 0,
      charging: false,
      downTimer: 0,
      staggerTimer: 0,
      reload: ((i * 13) % 20) / 10,
      ammo: def.missile?.ammo ?? 0,
      burn: 0,
      burnDps: 0,
      seek: i % 4,
      kills: 0,
      airborne: flyer,
      hitFrom: 0,
      flankTick: -999,
      flankKind: 0,
      ambush: true,
      attackers: 0,
      hotUntil: -1,
      hotX: 0,
      hotY: 0,
      hotR: 0,
    };
    u.soldiers.push(s);
    u.hpStart += hp;
  }
  // Glider meter.
  for (const m of def.mechanics ?? []) {
    if (m.kind === 'flyer' && m.glider) u.special.glide = m.glider.seconds;
    if (m.kind === 'elkTeam') {
      u.special.elkHp = u.hpStart * (m.hpPct / 100);
      u.special.elkMax = u.special.elkHp;
    }
  }
  layoutSlots(u);
  placeInFormation(u);
  return u;
}

/**
 * Share of a unit's starting hit points still standing, 0..1. Old Midnight's
 * elk team counts as part of it.
 */
export function unitHpShare(u: Unit): number {
  let now = 0;
  let max = 0;
  for (const s of u.soldiers) {
    max += s.maxHp;
    if (s.alive) now += Math.max(0, s.hp);
  }
  const elk = u.special.elkMax;
  if (elk) {
    max += elk;
    now += Math.max(0, u.special.elkHp ?? 0);
  }
  return max > 0 ? now / max : 0;
}

export function placeInFormation(u: Unit): void {
  const p = { x: 0, y: 0 };
  for (const s of u.soldiers) {
    if (!s.alive) continue;
    slotPos(u, s.slot, p);
    s.x = s.px = p.x;
    s.y = s.py = p.y;
    s.facing = slotFacing(u, s.slot);
  }
}

/**
 * Automatic deployment in a side's zone: melee infantry in the front line,
 * missiles behind, cavalry and beasts on the wings, artillery at the back,
 * the colossus at the center and the lord behind the line.
 */
export function autoDeploy(units: Unit[], side: Side, terrain: Terrain): void {
  const z = terrain.deployZone(side);
  const facing = side === 0 ? -HALF_PI : HALF_PI;
  const forward = side === 0 ? -1 : 1;
  const frontY = side === 0 ? z.y + 30 : z.y + z.h - 30;
  const cx = z.x + z.w / 2;
  const rows: Record<string, Unit[]> = { front: [], missile: [], wingL: [], wingR: [], back: [], center: [], lord: [] };
  const wings: Unit[] = [];
  for (const u of units) {
    const r = u.def.role;
    const c = u.def.category;
    if (r === 'colossus') rows.center!.push(u);
    else if (r === 'lord' || r === 'hero') rows.lord!.push(u);
    else if (r === 'artillery') rows.back!.push(u);
    else if (r === 'missile' || r === 'support') rows.missile!.push(u);
    else if (c === 'cavalry' || c === 'beast' || c === 'flyer' || r === 'missileCav') wings.push(u);
    else rows.front!.push(u);
  }
  wings.forEach((u, i) => (i % 2 === 0 ? rows.wingL! : rows.wingR!).push(u));
  if (terrain.fort && terrain.fort.defender === side) {
    fortDeploy(units, side, terrain);
    return;
  }
  const place = (list: Unit[], y: number, gap: number, center: number): number => {
    let total = 0;
    const widths = list.map((u) => formationSize(u).width + gap);
    for (const w of widths) total += w;
    let x = center - total / 2;
    list.forEach((u, i) => {
      const w = widths[i]!;
      u.x = x + w / 2;
      u.y = y;
      u.facing = facing;
      x += w;
    });
    return total;
  };
  // Mix monsters into the front line flanks.
  const frontW = place(rows.front!, frontY, 6, cx);
  place(rows.center!, frontY - forward * 8 - forward * 20, 10, cx);
  if (rows.center!.length) {
    // Colossus stands just behind the middle of the line.
    for (const u of rows.center!) u.y = frontY - forward * 34;
  }
  place(rows.missile!, frontY - forward * 34 - (rows.center!.length ? forward * 10 : 0), 8, cx);
  place(rows.back!, frontY - forward * 90, 14, cx);
  place(rows.lord!, frontY - forward * 60, 8, cx);
  const half = Math.max(160, frontW / 2 + 40);
  place(rows.wingL!, frontY - forward * 18, 10, cx - half - 60);
  place(rows.wingR!, frontY - forward * 18, 10, cx + half + 60);
  for (const u of units) {
    u.x = Math.max(z.x + 10, Math.min(z.x + z.w - 10, u.x));
    u.y = Math.max(z.y + 5, Math.min(z.y + z.h - 5, u.y));
    placeInFormation(u);
  }
}

function fortDeploy(units: Unit[], _side: Side, terrain: Terrain): void {
  const cx = terrain.width / 2;
  const cy = terrain.height / 2;
  const r = (terrain.fort?.radius ?? 200) - 40;
  let k = 0;
  const ring = units.filter((u) => u.def.role !== 'lord' && u.def.role !== 'hero' && u.def.role !== 'artillery');
  ring.forEach((u) => {
    const a = (k / Math.max(1, ring.length)) * TAU + PI / 2;
    k++;
    u.x = cx + dcos(a) * r;
    u.y = cy + dsin(a) * r;
    u.facing = a;
  });
  let j = 0;
  for (const u of units) {
    if (ring.includes(u)) continue;
    u.x = cx + ((j % 3) - 1) * 40;
    u.y = cy + Math.floor(j / 3) * 30 - 20;
    u.facing = PI / 2;
    j++;
  }
  for (const u of units) placeInFormation(u);
}
