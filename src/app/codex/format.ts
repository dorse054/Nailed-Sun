/**
 * Plain-English formatting for the Codex: numbers, weapons, zones, abilities
 * and the named mechanics declared in src/data/schema.ts. Every number shown
 * comes from the data files; nothing here adds rules of its own.
 */
import type {
  AbilityDef,
  Category,
  DamageType,
  FactionDef,
  LightLevel,
  Mechanic,
  MissileWeapon,
  OnHit,
  SizeClass,
  StatMods,
  Trajectory,
  UnitDef,
  ZoneDef,
} from '../../data/schema';
import { LIGHT_NAMES } from '../../data/schema';
import { allUnits, FACTIONS, hasUnit, unitDef } from '../../data/index';
import { ARMY, COMBAT, LIGHT_RULES, WIND_RULES } from '../../data/rules';
import { ZONES } from '../../data/zones';
import { hex } from '../../render/color';

/** Typographic minus for signed numbers. */
export const MINUS = '−';
/** No-break space, written as a code so it can't be mistaken for a plain space. */
export const NBSP = String.fromCharCode(0xa0);

/** 13000 -> "13,000"; 4.25 -> "4.25". */
export function num(x: number): string {
  return x.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

/** Signed, with a true minus sign: "+10", "−20%". */
export function signed(x: number, unit = ''): string {
  return `${x > 0 ? '+' : x < 0 ? MINUS : ''}${num(Math.abs(x))}${unit}`;
}

/** A 0..1 fraction as a percentage: 0.84 -> "84%". */
export function pct(f: number): string {
  return `${num(Math.round(f * 1000) / 10)}%`;
}

/** Quantities with units keep the number and unit on one line. */
export const secs = (x: number): string => `${num(x)}${NBSP}s`;
export const meters = (x: number): string => `${num(x)}${NBSP}m`;

/** "a", "a and b", "a, b and c". */
export function list(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

export const DAMAGE_NAMES: Record<DamageType, string> = { normal: 'Normal', fire: 'Fire', cold: 'Cold', resonance: 'Resonance' };
export const SIZE_NAMES: Record<SizeClass, string> = { small: 'Small', large: 'Large', colossal: 'Colossal' };
export const CATEGORY_NAMES: Record<Category, string> = {
  infantry: 'Infantry',
  cavalry: 'Cavalry',
  beast: 'Beast',
  monster: 'Monster',
  artillery: 'Artillery',
  flyer: 'Flyer',
  colossus: 'Colossus',
  character: 'Character',
};
export const TRAJECTORY_NAMES: Record<Trajectory, string> = {
  arc: 'Arcing',
  direct: 'Direct',
  beam: 'Beam',
  lineBeam: 'Line beam',
  cone: 'Cone',
};
const TARGET_NAMES: Record<AbilityDef['target'], string> = {
  self: 'Self',
  point: 'Aimed at a point',
  enemy: 'Aimed at an enemy',
  ally: 'Aimed at an ally',
  direction: 'Aimed in a direction',
};

/** "26 + 12 AP (fire)". */
export function damageText(base: number, ap: number, type?: DamageType): string {
  const t = type && type !== 'normal' ? ` (${DAMAGE_NAMES[type].toLowerCase()})` : '';
  return `${num(base)} + ${num(ap)} AP${t}`;
}

/** Light levels up to a maximum, brightest first: 1 -> "Dim or Dark". */
export function lightUpTo(max: LightLevel): string {
  const names: string[] = [];
  for (let l = max; l >= 0; l--) names.push(LIGHT_NAMES[l]!);
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}` : names[0]!;
}

// Stat modifiers, as used by zones and stances.
type ModText = { [K in keyof StatMods]-?: (v: NonNullable<StatMods[K]>) => string };
const MOD_TEXT: ModText = {
  ma: (v) => `${signed(v)} melee attack`,
  md: (v) => `${signed(v)} melee defense`,
  maPct: (v) => `${signed(v, '%')} melee attack`,
  mdPct: (v) => `${signed(v, '%')} melee defense`,
  dmgPct: (v) => `${signed(v, '%')} melee damage`,
  missileDmgPct: (v) => `${signed(v, '%')} missile damage`,
  accuracyPct: (v) => `${signed(v, '%')} accuracy`,
  rangePct: (v) => `${signed(v, '%')} range`,
  reloadPct: (v) => `${signed(v, '%')} reload time`,
  speedPct: (v) => `${signed(v, '%')} speed`,
  attackSpeedPct: (v) => `${signed(v, '%')} attack speed`,
  chargeBonus: (v) => `${signed(v)} charge bonus`,
  chargeBonusPct: (v) => `${signed(v, '%')} charge bonus`,
  leadershipPct: (v) => `${signed(v, '%')} leadership`,
  moraleRegen: (v) => `recovers ${num(v)}% leadership per second`,
  moraleDrain: (v) => `loses ${num(v)}% leadership per second`,
  missileBlock: (v) => `${signed(v * 100, '%')} missile block`,
  armor: (v) => `${signed(v)} armor`,
  damageTakenPct: (v) => `${signed(v, '%')} damage taken`,
  fatigueRatePct: (v) => `${signed(v, '%')} fatigue rate`,
  fatigueRecoveryPct: (v) => `${signed(v, '%')} fatigue recovery`,
  spotPct: (v) => `${signed(v, '%')} spotting range`,
  noKnockback: () => 'immune to knockback',
  unbreakable: () => 'unbreakable',
  fearImmune: () => 'cannot be feared',
  ignoreDarkness: () => 'ignore darkness penalties',
  noFatigue: () => 'no fatigue',
  forceHidden: () => 'stays hidden while fighting',
  revealed: () => 'revealed',
  markedPct: (v) => `${signed(v, '%')} damage taken from stealth units`,
};

export function modsText(m: StatMods): string[] {
  const out: string[] = [];
  for (const k of Object.keys(m) as (keyof StatMods)[]) {
    const v = m[k];
    if (v === undefined || v === false || v === 0) continue;
    out.push((MOD_TEXT[k] as (x: unknown) => string)(v));
  }
  return out;
}

// Zones.

export function zoneName(id: string): string {
  return ZONES[id]?.name ?? id;
}

/** "At least Dusk" for light zones, "At most Dark" for dark ones. */
export function zoneLight(z: ZoneDef): string | null {
  if (!z.light) return null;
  return `${z.light.mode === 'floor' ? 'At least' : 'At most'} ${LIGHT_NAMES[z.light.level]}`;
}

/** Everything a zone does besides setting the light. */
export function zoneEffects(z: ZoneDef): string[] {
  const out: string[] = [];
  if (z.reveals) out.push('Reveals stealth');
  if (z.blocksBeams) out.push('Blocks beams');
  if (z.missileAccuracyInto) out.push(`${signed(z.missileAccuracyInto, '%')} accuracy for missiles fired into it`);
  if (z.glareSource) out.push('Enemies facing its source suffer glare');
  if (z.dps) out.push(`${num(z.dps.damage)} ${DAMAGE_NAMES[z.dps.type].toLowerCase()} damage per second to ${z.dps.friendly ? 'everyone' : 'enemies'} inside`);
  if (z.spreads) out.push('Spreads sunward in Breeze and Gale');
  if (z.windDelta) out.push(`Wind ${signed(z.windDelta)} step${Math.abs(z.windDelta) === 1 ? '' : 's'} inside`);
  const who = z.affects?.length ? `Enemy ${list(z.affects.map((c) => CATEGORY_NAMES[c].toLowerCase()))}` : 'Enemies';
  const enemy = z.enemyMods ? modsText(z.enemyMods) : [];
  if (z.drain) enemy.push(`${MINUS}${num(z.drain)}% leadership per second`);
  if (enemy.length) out.push(`${who} inside: ${enemy.join(', ')}`);
  const ally = z.allyMods ? modsText(z.allyMods) : [];
  if (ally.length) out.push(`Allies inside ${list(ally)}`);
  return out;
}

/** Zone a missile's `ignite` leaves behind, as the battle sim places it. */
export function igniteZone(w: MissileWeapon): string | null {
  if (!w.ignite) return null;
  return w.trajectory === 'lineBeam' ? 'burningLine' : w.kind === 'glassPot' ? 'moltenGlass' : 'burning';
}

/**
 * Units that create a zone (as an aura, with an ability, or where their shots
 * land) and the radius it has, which burning ground takes from each weapon.
 */
export function zoneMakers(id: string): { units: UnitDef[]; radius: string } {
  const z = ZONES[id];
  const units: UnitDef[] = [];
  const radii = new Set<number>();
  for (const u of allUnits()) {
    const found: number[] = [];
    const onHit = (hits: OnHit[] | undefined) => {
      for (const h of hits ?? []) if (h.kind === 'lightZone' && h.zone === id && z) found.push(z.radius);
    };
    for (const m of u.mechanics ?? []) if (m.kind === 'zone' && m.zone === id && z) found.push(z.radius);
    for (const a of u.abilities ?? []) for (const e of a.effects) if (e.kind === 'zone' && e.zone === id && z) found.push(z.radius);
    for (const w of [u.missile, u.altMissile, u.leader?.missile]) {
      if (!w) continue;
      if (w.impactZone?.zone === id && z) found.push(z.radius);
      if (w.ignite && igniteZone(w) === id) found.push(w.ignite.radius);
      onHit(w.onHit);
    }
    onHit(u.weapon.onHit);
    onHit(u.leader?.weapon.onHit);
    if (found.length) units.push(u);
    for (const r of found) radii.add(r);
  }
  const rs = [...radii].sort((a, b) => a - b);
  const radius = rs.length > 1 ? `${num(rs[0]!)}–${meters(rs[rs.length - 1]!)}` : meters(rs[0] ?? z?.radius ?? 0);
  return { units, radius };
}

// Weapons.

export function onHitText(e: OnHit): string {
  switch (e.kind) {
    case 'chill':
      return `Chill: ${signed(COMBAT.chill.speedPct, '%')} speed and ${signed(COMBAT.chill.attackSpeedPct, '%')} attack speed for ${secs(COMBAT.chill.duration)}`;
    case 'burn':
      return `Burn: ${num(e.dps)} damage per second for ${secs(e.duration)}`;
    case 'stagger':
      return `Staggers for ${secs(e.duration)}`;
    case 'knockdown':
      return `${pct(e.chance)} chance to knock down`;
    case 'leadership':
      return `Each hit drains ${num(e.pct)}% leadership`;
    case 'mark':
      return `Marks the target for ${secs(e.duration)}`;
    case 'slow':
      return `Slows ${e.largeOnly ? 'large targets' : 'the target'} ${num(e.pct)}% for ${secs(e.duration)}${e.grounds ? ' and pulls flyers to the ground' : ''}`;
    case 'swallow':
      return `Swallow: ${pct(e.chance)} chance per hit to kill a small soldier outright`;
    case 'lightZone':
      return `Leaves ${zoneName(e.zone)} for ${secs(e.duration)}`;
  }
}

/** Special properties of a missile weapon, one short line each. */
export function missileFlags(w: MissileWeapon): string[] {
  const out: string[] = [];
  if (w.lightScaled) out.push(`Light-scaled: ${pct(LIGHT_RULES[4].beamMult)} damage in Blaze down to ${pct(LIGHT_RULES[0].beamMult)} in Dark`);
  if (w.windless) out.push('Ignores wind');
  if (w.needsLOS) out.push('Needs line of sight');
  if (w.whileMoving) out.push('Fires while moving');
  if (w.focus) out.push(`Focuses for ${secs(w.focus)} before the first shot at a new target`);
  if (w.ignoresShields) out.push('Ignores shields');
  if (w.armorMult && w.armorMult !== 1) out.push(`Armor counts ${num(w.armorMult)}× against it`);
  if (w.preferLarge) out.push('Prefers large and colossal targets');
  if (w.vsFlyerPct) out.push(`${signed(w.vsFlyerPct, '%')} damage against flyers`);
  if (w.pierce) out.push(`Pierces up to ${num(w.pierce)} soldiers in a line`);
  if (w.cone) out.push(`Hits everything in a ${num(w.cone.angle)}° cone`);
  if (w.knockback) out.push('Knocks soldiers down');
  if (w.ignite) {
    const z = ZONES[igniteZone(w) ?? ''];
    out.push(`Sets the ground alight${z ? ` (${z.name.toLowerCase()})` : ''}: ${meters(w.ignite.radius)} radius, ${num(w.ignite.dps)} fire damage per second for ${secs(w.ignite.duration)}`);
  }
  if (w.impactZone) {
    const z = ZONES[w.impactZone.zone];
    const fx = z ? zoneEffects(z).map((s) => s.charAt(0).toLowerCase() + s.slice(1)) : [];
    out.push(`${zoneName(w.impactZone.zone)} where it lands, for ${secs(w.impactZone.duration)}${fx.length ? ` (${fx.join('; ')})` : ''}`);
  }
  for (const h of w.onHit ?? []) out.push(onHitText(h));
  return out;
}

// Abilities.

export function abilityFacts(a: AbilityDef): string[] {
  const out: string[] = [a.kind === 'toggle' ? 'Toggle' : 'Active'];
  if (a.uses !== undefined) out.push(a.uses === 1 ? 'Once per battle' : `${a.uses} uses per battle`);
  if (a.cooldown) out.push(`Cooldown ${secs(a.cooldown)}`);
  if (a.windup) out.push(`Windup ${secs(a.windup)}`);
  if (a.channel) out.push(`Channel ${secs(a.channel)}`);
  if (a.range) out.push(`Range ${meters(a.range)}`);
  if (a.target !== 'self') out.push(TARGET_NAMES[a.target]);
  return out;
}

/** What a toggle's stance does while it is on. */
export function stanceText(a: AbilityDef): string[] {
  const s = a.stance;
  if (!s) return [];
  const out: string[] = [];
  if (s.formation) out.push(s.formation === 'ring' ? 'ring formation' : 'square formation');
  if (s.immobile) out.push('cannot move');
  if (s.brace) out.push(`brace ${num(s.brace)} against charges`);
  if (s.mods) out.push(...modsText(s.mods));
  if (s.lightOff) out.push('its light goes out');
  if (s.altMissile) out.push('fires its alternate ammunition');
  if (s.exitTime) out.push(`takes ${secs(s.exitTime)} to leave`);
  return out;
}

// Named mechanics.

/** The unit with a given mechanic, for cross-references (the Dreadsail for refits). */
function unitWith(kind: Mechanic['kind']): UnitDef | undefined {
  return allUnits().find((u) => u.mechanics?.some((m) => m.kind === kind));
}

function repairTargets(def: UnitDef | undefined): string[] {
  const ids = def?.abilities?.flatMap((a) => a.effects.flatMap((e) => (e.kind === 'repair' ? e.targets : []))) ?? [];
  return ids.filter(hasUnit).map((id) => unitDef(id).name);
}

/** A named mechanic as a short name and one plain sentence. */
export function mechanicText(m: Mechanic, def?: UnitDef): { name: string; desc: string } {
  switch (m.kind) {
    case 'brittle':
      return { name: 'Brittle', desc: `Takes ${signed(Math.round((COMBAT.brittleMult - 1) * 100), '%')} damage from cold and resonance.` };
    case 'glassblind':
      return { name: 'Glassblind', desc: 'Immune to glare.' };
    case 'mirrorflash':
      return { name: 'Mirrorflash', desc: 'While it faces the sun, enemies it fights suffer glare as if they faced the sun themselves.' };
    case 'lockMirrors':
      return { name: 'Lock Mirrors', desc: `Standing still: ${signed(m.block * 100, '%')} missile block and a dazzle cone reaching ${meters(m.dazzleRange)} ahead.` };
    case 'noFatigueInLight':
      return { name: 'Tireless in light', desc: 'No fatigue in Bright or Blaze.' };
    case 'burningFaith':
      return { name: 'Burning Faith', desc: `Unbreakable in Bright and Blaze, but loses ${num(m.hpLossPct)}% HP per second in combat.` };
    case 'coldBlooded':
      return { name: 'Cold-blooded', desc: `${signed(m.blazeSpeedPct, '%')} speed in Blaze, ${signed(m.darkSpeedPct, '%')} in Dark.` };
    case 'moltenCore':
      return { name: 'Molten Core', desc: `Melee attackers take fire damage, up to ${num(m.damage)} per blow.` };
    case 'glows':
      return { name: 'Glows', desc: 'Can never hide.' };
    case 'marks':
      return { name: 'Marks', desc: `Enemies it fights are Marked: revealed, and taking ${signed(m.pct, '%')} damage from Hush stealth units.` };
    case 'stealth': {
      const where = [m.lightMax !== undefined ? `${lightUpTo(m.lightMax)} light` : '', m.shadow ? 'shadow' : '', m.forest ? 'forest' : '']
        .filter(Boolean)
        .map((p) => `in ${p}`);
      const moving = m.whileMoving ? ', even while moving' : ', but only while standing still';
      const fire = m.revealOnFire === 'notInDark' ? "Shooting doesn't reveal it in Dark." : 'Fighting or shooting reveals it.';
      return { name: 'Stealth', desc: `Hides ${list(where)}${moving}. ${fire}` };
    }
    case 'ambush':
      return { name: 'Ambush', desc: `Its first strike from stealth deals ${signed(m.dmgPct, '%')} damage${m.fear ? ' and causes fear' : ''}.` };
    case 'silentCharge':
      return { name: 'Silent Charge', desc: 'A charge from stealth causes fear.' };
    case 'zone': {
      const z = ZONES[m.zone];
      if (!z) return { name: m.zone, desc: 'Carries a zone that moves with it.' };
      const off = m.toggleable ? ' It can be switched off.' : '';
      const fx = zoneEffects(z);
      const rest = fx.length ? ` ${fx.join('. ')}.` : '';
      if (!z.light) return { name: z.name, desc: `A ${num(z.radius)}-m zone that moves with it.${rest}${off}` };
      const kind = z.light.mode === 'floor' ? 'light' : 'dark';
      const holds = `${z.light.mode === 'floor' ? 'at least' : 'at most'} ${LIGHT_NAMES[z.light.level]}`;
      return {
        name: z.name,
        desc: `A ${kind} zone of intensity ${z.light.intensity} and ${num(z.radius)}-m radius that moves with it and keeps the light ${holds}.${rest}${off}`,
      };
    }
    case 'blind':
      return { name: 'Blind', desc: 'Ignores glare, dazzle and Mirrorflash.' };
    case 'flyer':
      return m.glider
        ? { name: 'Glider', desc: `Airborne, with ${secs(m.glider.seconds)} of glide time. Gliders lose altitude in Calm.` }
        : { name: 'Flyer', desc: `Airborne. In a Gale it flies ${WIND_RULES[2].flyerDownwindSpeedPct}% faster downwind.` };
    case 'fireVulnerable':
      return { name: 'Fire-vulnerable', desc: `Takes ${signed(m.pct, '%')} damage from fire.` };
    case 'lure':
      return { name: 'Lure', desc: `Enemy infantry within ${meters(m.radius)} are entranced: ${signed(-Math.abs(m.mdPenalty))} melee defense.` };
    case 'hooks':
      return { name: 'Hooks', desc: 'Cancel the charge of any large, but not colossal, unit on impact.' };
    case 'braceBonus':
      return { name: 'Brace', desc: `Standing still and facing a charge, it cancels up to ${num(m.value)} points of the charger's bonus.` };
    case 'pavise':
      return { name: 'Pavise', desc: `${signed(m.block * 100, '%')} missile block while standing still.` };
    case 'bell': {
      const range = m.range === 'field' ? 'across the whole field' : `within ${meters(m.range)}`;
      const drain = m.drainWavering ? ` Each Toll costs wavering enemies ${num(m.drainWavering)}% leadership.` : '';
      return { name: 'Bell', desc: `Rings the Toll every ${secs(m.interval)}, heard ${range}.${drain}` };
    }
    case 'tollRelay':
      return { name: 'Toll relay', desc: `Carries the Toll ${meters(m.extra)} beyond its normal range.` };
    case 'tollCharge':
      return { name: 'Charge on the bell', desc: 'A charge launched on the Toll gets double charge bonus.' };
    case 'scatter':
      return { name: 'Scatter', desc: `A loose formation that takes ${pct(m.missileReduction)} less damage from missiles and artillery.` };
    case 'moored':
      return { name: 'Moored', desc: 'Immune to knockback.' };
    case 'leapingCharge':
      return { name: 'Leaping Charge', desc: "Downwind charges clear obstacles and ignore half the target's brace bonus." };
    case 'howl':
      return { name: 'Howl', desc: `Enemies within ${meters(m.radius)} downwind lose ${num(m.drain)}% leadership per second.` };
    case 'fearAura':
      return { name: 'Fear aura', desc: `Enemies within ${meters(m.radius)} lose ${num(m.drain)}% leadership per second.` };
    case 'hearHidden':
      return { name: 'Keen hearing', desc: `Hears hidden enemies within ${meters(m.radius)}.` };
    case 'hideAura':
      return { name: 'Shroud', desc: `Friendly units within ${meters(m.radius)} hide more easily.` };
    case 'heatImmune':
      return { name: 'Heat-proof', desc: 'Immune to heat and burning ground.' };
    case 'vsRouting':
      return { name: 'Runs them down', desc: `${signed(m.pct, '%')} melee damage against routing units.` };
    case 'vsMissile':
      return { name: 'Archer hunter', desc: `${signed(m.pct, '%')} melee damage against missile infantry.` };
    case 'colossus':
      return {
        name: 'Colossus',
        desc: `At most ${ARMY.maxColossi} per army. It never routs, and stuns and knockdowns land on it at most once every ${secs(COMBAT.colossusStunLockout)}.`,
      };
    case 'garrison':
      return { name: 'Garrison', desc: `Up to ${num(m.slots)} missile infantry units can ride inside and shoot from it.` };
    case 'carrier':
      return { name: 'Carrier', desc: 'Gliders refit near it, and one unit of Windbows can ride on its deck.' };
    case 'sailing':
      return { name: 'Sailing', desc: 'Its speed depends on the wind: fastest running downwind in a Gale. Deck weapons fire broadsides, and fire sets its sails alight.' };
    case 'elkTeam':
      return { name: 'Elk team', desc: `Blows from the front land on its elk team first, worth ${num(m.hpPct)}% of its HP. Kill the elk team and it cannot move.` };
    case 'drawnToFlame':
      return { name: 'Drawn to the Flame', desc: `${signed(m.dmgPct, '%')} melee damage against enemies that cast strong light (intensity 2 or more).` };
    case 'coreExposed':
      return { name: 'Exposed core', desc: 'Takes double damage from the front while its chest is open during Noon Lance.' };
    case 'signalMark':
      return { name: 'Signal', desc: `Friendly artillery gets ${signed(m.accuracyPct, '%')} accuracy against enemies in its signal zone.` };
    case 'repairer': {
      const t = repairTargets(def);
      return { name: 'Repairer', desc: t.length ? `Repairs ${list(t)}.` : 'Repairs war machines and colossi.' };
    }
    case 'refitsOnCarrier': {
      const carrier = unitWith('carrier');
      return { name: 'Refit', desc: `Regains glide time and ammunition near ${carrier ? carrier.name : 'a carrier'}.` };
    }
    case 'feignedFlight':
      return { name: 'Feigned Flight', desc: 'Withdrawing costs no leadership, and it can turn and fight at once.' };
    case 'windReader':
      return { name: 'Wind-Reader', desc: 'Ignores the Gale accuracy penalty.' };
    case 'lanternSight':
      return { name: 'Lantern sight', desc: 'Halves the spotting penalty in Dim and Dark.' };
  }
}

/**
 * Mechanic lines for a unit's page, leaving out any that a passive or an
 * ability of the same name already explains.
 */
export function unitMechanics(def: UnitDef): { name: string; desc: string }[] {
  const taken = new Set([...(def.passives ?? []), ...(def.abilities ?? [])].map((x) => x.name.toLowerCase()));
  const repairs = def.abilities?.some((a) => a.effects.some((e) => e.kind === 'repair')) ?? false;
  return (def.mechanics ?? [])
    .filter((m) => !(m.kind === 'repairer' && repairs))
    .map((m) => mechanicText(m, def))
    .filter((t) => !taken.has(t.name.toLowerCase()));
}

// Units and factions.

/** Damage types a unit deals: its weapons, its lord's weapons and its damaging abilities. */
export function unitDamageTypes(u: UnitDef): Set<DamageType> {
  const out = new Set<DamageType>();
  const add = (t: DamageType | undefined) => out.add(t ?? 'normal');
  add(u.weapon.type);
  if (u.leader) add(u.leader.weapon.type);
  for (const w of [u.missile, u.altMissile, u.leader?.missile]) if (w) add(w.type);
  for (const a of u.abilities ?? []) for (const e of a.effects) if (e.kind === 'damage') add(e.type);
  return out;
}

/**
 * A palette color that reads as text on the Codex's dark panels:
 * the primary color if it is light enough, else the faction's glow.
 */
export function readableAccent(f: FactionDef): string {
  const lum = (c: string) => {
    const [r, g, b] = hex(c).map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    }) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  // Relative luminance 0.31 keeps at least 4.5:1 contrast on every panel, up to --panel-3.
  for (const c of [f.palette.primary, f.palette.glow, f.palette.metal, f.palette.secondary]) if (lum(c) >= 0.31) return c;
  return f.palette.glow;
}

/** CSS custom properties for a faction's accents. Body text keeps the UI tokens. */
export function factionVars(f: FactionDef): Record<string, string> {
  return {
    '--fa': readableAccent(f),
    '--fp': f.palette.primary,
    '--fs': f.palette.secondary,
    '--fm': f.palette.metal,
    '--fg': f.palette.glow,
    '--fd': f.palette.dark,
  };
}

/** Matches band "home" text such as "The Hush" to a faction. */
export function factionByName(name: string): FactionDef | undefined {
  return Object.values(FACTIONS).find((f) => f.name === name || `The ${f.short}` === name);
}
